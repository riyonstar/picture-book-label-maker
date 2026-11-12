"""ブラウザ E2E テスト（任意実行）。

必要: Python 3 + playwright + Pillow + poppler(pdftoppm/pdfinfo) + Chrome
実行: node scripts/serve.mjs --dir . --port 5173 &
      node scripts/serve.mjs --dir dist --port 4173 --base /ehon-label-maker/ &
      python3 tests/e2e.py

外部API（openBD / Google Books 等）はモックで応答させる。
カメラは Chrome のフェイクカメラ（バーコード入りの動画ファイル）を使う。
"""
import base64, io, json, os, random, re, subprocess, sys
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'out')
os.makedirs(OUT, exist_ok=True)
DEV = os.environ.get('DEV_URL', 'http://localhost:5173/')
PREVIEW = os.environ.get('PREVIEW_URL', 'http://localhost:4173/ehon-label-maker/')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

# ------------------------------------------------------------------ テストデータ
def with_check(p12):
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(p12))
    return p12 + str((10 - s % 10) % 10)

ISBN1 = with_check('978483400082')   # カメラで読む
ISBN2 = with_check('978400115670')   # 写真で読む（表紙: 正方形）
ISBN3 = with_check('978403327060')   # 手入力（Google Books 経由・縦長表紙）
ISBN4 = with_check('978409725010')   # 表紙なし

L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
P = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

def ean_bits(code):
    d = [int(c) for c in code]
    b = '101'
    for i in range(6):
        b += (L if P[d[0]][i] == 'L' else G)[d[i + 1]]
    b += '01010'
    for i in range(6):
        b += R[d[i + 7]]
    return b + '101'

def barcode_image(code, module, height, quiet=11):
    bits = '0' * quiet + ean_bits(code) + '0' * quiet
    im = Image.new('RGB', (len(bits) * module, height), 'white')
    d = ImageDraw.Draw(im)
    for i, c in enumerate(bits):
        if c == '1':
            d.rectangle([i * module, 0, (i + 1) * module - 1, height], fill=(20, 20, 20))
    return im

def book_back_photo(code, path, size=(1600, 1200), angle=3):
    """本の裏表紙を撮った写真っぽい画像（斜め・ノイズ・ぼかし付き）"""
    random.seed(1)
    im = Image.new('RGB', size, (205, 190, 170))
    d = ImageDraw.Draw(im)
    d.rectangle([150, 100, size[0] - 150, size[1] - 100], fill=(246, 240, 225))
    for i in range(6):
        d.rectangle([260, 190 + i * 40, 900 - random.randint(0, 200), 210 + i * 40], fill=(120, 110, 100))
    bc = barcode_image(code, 4, 230)
    holder = Image.new('RGB', (bc.width + 40, bc.height + 40), 'white')
    holder.paste(bc, (20, 20))
    im.paste(holder, (size[0] - holder.width - 220, size[1] - holder.height - 170))
    im = im.rotate(angle, resample=Image.BICUBIC, fillcolor=(205, 190, 170))
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    px = im.load()
    for _ in range(size[0] * size[1] // 14):
        x, y = random.randrange(size[0]), random.randrange(size[1])
        v = random.randint(-18, 18)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    im.save(path, quality=88)

def cover_image(w, h, c1, c2, path=None):
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        t = y / h
        col = tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = col
    d = ImageDraw.Draw(im)
    m = min(w, h)
    d.ellipse([w * .55, h * .1, w * .55 + m * .25, h * .1 + m * .25], fill=(255, 255, 255))
    d.polygon([(0, h), (w * .4, h * .55), (w * .8, h)], fill=(40, 80, 40))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=90)
    if path: im.save(path, quality=90)
    return buf.getvalue()

# 注意: 正方形の表紙は全面が鮮やかな色（PDFの25mm実寸測定に使う）
COVER2 = cover_image(500, 500, (240, 120, 40), (200, 40, 40))
COVER1 = cover_image(420, 560, (80, 140, 220), (30, 60, 140))
COVER3 = cover_image(380, 540, (110, 190, 100), (30, 120, 60))
PHOTO_COVER = os.path.join(OUT, 'photo_cover.jpg'); cover_image(900, 600, (230, 200, 60), (190, 120, 30), PHOTO_COVER)

BARCODE_PHOTO = os.path.join(OUT, 'barcode_photo.jpg'); book_back_photo(ISBN2, BARCODE_PHOTO)
# フェイクカメラ用の動画（MJPEG）：ISBN1 のバーコードを持った映像
frames = []
for k in range(8):
    f = Image.new('RGB', (1280, 720), (180, 170, 160))
    bc = barcode_image(ISBN1, 5, 260)
    holder = Image.new('RGB', (bc.width + 60, bc.height + 60), 'white'); holder.paste(bc, (30, 30))
    holder = holder.rotate(1.5 + k * 0.2, expand=True, fillcolor=(180, 170, 160), resample=Image.BICUBIC)
    f.paste(holder, ((1280 - holder.width) // 2, (720 - holder.height) // 2))
    b = io.BytesIO(); f.save(b, 'JPEG', quality=85); frames.append(b.getvalue())
FAKE_VIDEO = os.path.join(OUT, 'fake_camera.mjpeg')
open(FAKE_VIDEO, 'wb').write(b''.join(frames))

# ------------------------------------------------------------------ 外部APIのモック
CORS = {'access-control-allow-origin': '*'}

def mock_external(route):
    u = urlparse(route.request.url)
    q = parse_qs(u.query)
    host = u.hostname

    def ok_json(obj):
        route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps(obj))
    def img(data):
        route.fulfill(status=200, headers=CORS, content_type='image/jpeg', body=data)
    def nf():
        route.fulfill(status=404, headers=CORS, content_type='text/plain', body='not found')

    if host in ('localhost', '127.0.0.1'):
        return route.continue_()
    if host == 'api.openbd.jp':
        isbn = q['isbn'][0]
        if isbn == ISBN1:
            return ok_json([{'summary': {'title': 'テスト絵本いち', 'author': 'テスト 一郎／作', 'publisher': 'テスト出版', 'cover': f'https://cover.openbd.jp/{isbn}.jpg'}}])
        if isbn == ISBN2:
            return ok_json([{'summary': {'title': 'テスト絵本に', 'author': 'テスト 二郎／作', 'publisher': 'テスト書房', 'cover': f'https://cover.openbd.jp/{isbn}.jpg'}}])
        return ok_json([None])
    if host == 'cover.openbd.jp':
        isbn = u.path.strip('/').split('.')[0]
        return img(COVER1 if isbn == ISBN1 else COVER2) if isbn in (ISBN1, ISBN2) else nf()
    if host == 'www.googleapis.com':
        if q['q'][0] == 'isbn:' + ISBN3:
            return ok_json({'totalItems': 1, 'items': [{'id': 'GB3', 'volumeInfo': {'title': 'テスト絵本さん', 'authors': ['テスト 三郎', '絵：テスト 花'], 'publisher': 'グーグル出版', 'imageLinks': {'thumbnail': 'http://books.google.com/x?zoom=1'}}}]})
        return ok_json({'totalItems': 0})
    if host == 'books.google.com':
        return img(COVER3) if q.get('id') == ['GB3'] else nf()
    if host == 'openlibrary.org':
        return ok_json({})
    return nf()   # NDL / openlibrary covers / weserv proxy など

# ------------------------------------------------------------------ ヘルパー
fails = []
def check(cond, msg):
    print(('✔ ' if cond else '✖ ') + msg)
    if not cond:
        fails.append(msg)

def new_page(browser, name, accept_dialogs=True):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              permissions=['camera'], locale='ja-JP', timezone_id='Asia/Tokyo')
    ctx.route('**/*', mock_external)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console.error: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.errors = errors
    page.messages = []
    page.accept_dialogs = accept_dialogs
    def on_dialog(d):
        page.messages.append(d.message)
        d.accept() if page.accept_dialogs else d.dismiss()
    page.on('dialog', on_dialog)
    return ctx, page

def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + '.png'))

def wait_detail_ready(page, text='表紙を取得しました', timeout=20000):
    page.wait_for_selector('[data-screen="detail"]', timeout=timeout)
    page.wait_for_function('t => (document.querySelector("[data-testid=status]")||{}).textContent?.includes(t)', arg=text, timeout=timeout)

def field(page, key):
    return page.input_value(f'[data-field="{key}"]')

# ------------------------------------------------------------------ テスト本体
def run():
    with sync_playwright() as p:
        # ===== A. カメラ（フェイクカメラ）で ISBN を読む =====
        print('\n=== A. カメラ読み取り ===')
        br = p.chromium.launch(executable_path=CHROME, headless=True, args=[
            '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            f'--use-file-for-fake-video-capture={FAKE_VIDEO}'])
        ctx, page = new_page(br, 'A')
        page.goto(DEV)
        page.wait_for_selector('[data-screen="home"]')
        check('絵本ラベルメーカー' in page.inner_text('h1'), 'ホーム画面にタイトルが表示される')
        check(page.inner_text('[data-testid=count]') == '0', '登録済み 0冊')
        check(page.get_by_role('button', name='PDFを作成', exact=True).is_disabled(), '0冊のときPDFを作成は押せない')
        shot(page, '01_home_empty')
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.wait_for_selector('[data-screen="add"]')
        page.wait_for_selector('.scan-video')
        check(True, 'カメラ映像（scan-video）が起動')
        shot(page, '02_add_camera')
        wait_detail_ready(page)
        check(field(page, 'isbn') == ISBN1, f'カメラでISBNを読み取れた: {field(page, "isbn")}')
        check(field(page, 'title') == 'テスト絵本いち', 'タイトル自動入力（openBD）')
        check(field(page, 'author') == 'テスト 一郎／作' and field(page, 'publisher') == 'テスト出版', '著者・出版社の自動入力')
        check(page.locator('[data-testid=cover-box] img').count() == 1, '表紙画像が表示される')
        shot(page, '03_detail')
        page.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_selector('[data-screen="home"]')
        page.wait_for_selector('.book-card')
        check(page.inner_text('[data-testid=count]') == '1', '保存して登録済み 1冊')
        page.reload()
        page.wait_for_selector('.book-card')
        check(page.inner_text('[data-testid=count]') == '1', 'リロードしても保存データが残る（IndexedDB）')
        check(not page.errors, 'A: コンソールエラーなし ' + str(page.errors))
        ctx.close(); br.close()

        # ===== B. カメラなし端末：写真・手入力・トリミング・PDF =====
        print('\n=== B. 写真/手入力/トリミング/PDF ===')
        br = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page = new_page(br, 'B')
        page.goto(DEV)
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.wait_for_selector('[data-screen="add"]')
        page.wait_for_selector('.scan-msg:has-text("カメラ")')
        check('カメラ' in page.inner_text('.scan-msg'), 'カメラ不可のときは案内メッセージ: ' + page.inner_text('.scan-msg')[:40])
        shot(page, '04_add_nocamera')

        # --- B1. 写真からバーコードを読む
        page.set_input_files('[data-screen="add"] [data-testid=photo-input]', BARCODE_PHOTO)
        wait_detail_ready(page)
        check(field(page, 'isbn') == ISBN2, f'写真（斜め・ノイズ付き）からISBNを読み取れた: {field(page, "isbn")}')
        check(field(page, 'title') == 'テスト絵本に', '写真経由でも書誌情報を取得')

        # --- トリミング
        before = page.get_attribute('[data-testid=cover-box] img', 'src')
        page.get_by_role('button', name='トリミング', exact=True).click()
        page.wait_for_selector('[data-screen="crop"] [data-testid=crop-viewport]')
        shot(page, '05_crop_before')
        vp = page.locator('[data-testid=crop-viewport]')
        box = vp.bounding_box()
        check(abs(box['width'] - box['height']) < 1.5, f'クロップ枠は正方形 ({box["width"]:.0f}x{box["height"]:.0f})')
        for _ in range(4):
            page.click('button[aria-label="拡大"]')
        page.click('button[aria-label="左へ移動"]')
        page.click('button[aria-label="上へ移動"]')
        # ドラッグ移動
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 20, cy + 15, steps=4); page.mouse.up()
        # ホイールでも拡大縮小
        page.mouse.move(cx, cy); page.mouse.wheel(0, -120)
        shot(page, '06_crop_after')
        page.get_by_role('button', name='決定', exact=True).click()
        page.wait_for_selector('[data-screen="detail"]')
        after = page.get_attribute('[data-testid=cover-box] img', 'src')
        check(before != after, 'トリミングが表紙画像に反映される')
        dims = page.evaluate("""() => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = document.querySelector('[data-testid=cover-box] img').src; })""")
        check(dims == [480, 480], f'保存画像は 480x480 の正方形: {dims}')
        # そのまま使用 → 元に戻る
        page.get_by_role('button', name='そのまま使用', exact=True).click()
        page.wait_for_function('s => document.querySelector("[data-testid=cover-box] img").src !== s', arg=after)
        check(True, '「そのまま使用」で全体表示に戻る')
        page.get_by_role('button', name='トリミング', exact=True).click(); page.wait_for_selector('[data-screen="crop"]'); page.click('button[aria-label="拡大"]'); page.get_by_role('button', name='決定', exact=True).click()
        page.wait_for_selector('[data-screen="detail"]')
        page.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_selector('.book-card')

        # --- B2. 手入力（openBDに無く Google Books から取得・縦長表紙）
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.click('summary:has-text("ISBNを手入力")')
        page.fill('[data-testid=isbn-input]', ISBN3)
        page.click('button:has-text("検索")')
        wait_detail_ready(page)
        check(field(page, 'title') == 'テスト絵本さん', 'Google Books へフォールバックして書誌情報を取得')
        check(field(page, 'author') == 'テスト 三郎、絵：テスト 花', '複数著者を連結')
        page.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_selector('.book-card')

        # --- B3. 表紙が見つからない → 写真から選択
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.click('summary:has-text("ISBNを手入力")')
        page.fill('[data-testid=isbn-input]', ISBN4)
        page.click('button:has-text("検索")')
        page.wait_for_function('() => (document.querySelector("[data-testid=status]")||{}).textContent?.includes("見つかりませんでした")', timeout=20000)
        check(True, '表紙が無い場合はメッセージを表示')
        page.fill('[data-field="title"]', '表紙なしの絵本')
        page.get_by_role('button', name='保存', exact=True).click()
        check('表紙画像がありません' in page.inner_text('.toast'), '表紙なしでは保存できない')
        page.set_input_files('[data-screen="detail"] [data-testid=photo-input]', PHOTO_COVER)
        page.wait_for_function('() => (document.querySelector("[data-testid=status]")||{}).textContent?.includes("写真を表紙")')
        check(True, '「写真から選択」で表紙を登録できる')
        shot(page, '07_detail_photo')
        page.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_selector('.book-card')
        check(page.inner_text('[data-testid=count]') == '3', '登録済み 3冊')
        shot(page, '08_list')

        # --- B4. バーコードのない写真 → 表紙として登録
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.wait_for_selector('.scan-msg')
        page.set_input_files('[data-screen="add"] [data-testid=photo-input]', PHOTO_COVER)
        page.wait_for_selector('[data-screen="detail"]', timeout=20000)
        check(any('バーコードを読み取れません' in m for m in page.messages), 'バーコード無しの写真は表紙として登録するか確認される')
        check(page.locator('[data-testid=cover-box] img').count() == 1, '写真が表紙として設定される')
        page.click('.back')
        page.wait_for_selector('.book-card')
        check(page.inner_text('[data-testid=count]') == '3', '戻ると保存されない（3冊のまま）')

        # --- 削除（キャンセルして残る）
        page.accept_dialogs = False
        page.click('button[aria-label="表紙なしの絵本を削除"]')
        page.accept_dialogs = True
        check(page.inner_text('[data-testid=count]') == '3', '削除確認でキャンセルすると残る')

        # --- PDF
        page.get_by_role('button', name='PDFを作成', exact=True).click()
        page.wait_for_selector('[data-screen="pdf"] [data-testid=sheet]')
        page.wait_for_timeout(300)
        check(page.locator('[data-testid=cell]').count() == 3, 'プレビューに3枚並ぶ')
        sheet = page.locator('[data-testid=sheet]').bounding_box()
        cell = page.locator('[data-testid=cell]').first.bounding_box()
        wrap_w = page.locator('.sheet-wrap').bounding_box()['width']
        check(abs(cell['width'] / sheet['width'] - 25 / 210) < 0.003, f'プレビュー上でも 25/210 の比率（用紙幅に対し {cell["width"] / sheet["width"] * 210:.2f}mm）')
        check(abs(sheet['height'] / sheet['width'] - 297 / 210) < 0.01, 'A4 縦の比率')
        shot(page, '09_pdf_preview')
        page.click('[data-testid=make-pdf]')
        page.wait_for_selector('[data-testid=pdf-link]')
        url = page.get_attribute('[data-testid=pdf-link]', 'href')
        b64 = page.evaluate("""async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s=''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }""", url)
        pdf_path = os.path.join(OUT, 'labels.pdf')
        open(pdf_path, 'wb').write(base64.b64decode(b64))
        shot(page, '10_pdf_done')
        check(not page.errors, 'B: コンソールエラーなし ' + str(page.errors))
        ctx.close(); br.close()
        verify_pdf(pdf_path, 3)

        # ===== C. 本番ビルド（サブパス）+ PWA =====
        print('\n=== C. dist をサブパス配信（GitHub Pages 相当）===')
        br = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page = new_page(br, 'C')
        bad = []
        page.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 and urlparse(r.url).hostname == 'localhost' else None)
        page.goto(PREVIEW)
        page.wait_for_selector('[data-screen="home"]')
        check(not bad, '本番ビルドで 404 などが無い ' + str(bad))
        page.wait_for_function('navigator.serviceWorker.ready.then(() => true)')
        page.reload()
        page.wait_for_function('!!navigator.serviceWorker.controller', timeout=10000)
        check(True, 'Service Worker が登録され、ページを制御している')
        cached = page.evaluate("caches.keys().then(async ks => { const c = await caches.open(ks[0]); return (await c.keys()).length; })")
        check(cached >= 15, f'アプリ本体 {cached} 件をキャッシュ済み')
        mf = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
        check(mf['display'] == 'standalone' and mf['start_url'] == './', 'manifest.json を取得できる (standalone)')
        icon_ok = page.evaluate("fetch(new URL('icons/icon-512.png', location.href)).then(r => r.status)")
        check(icon_ok == 200, 'アイコンを取得できる')
        # オフライン起動
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector('[data-screen="home"]', timeout=10000)
        check(True, 'オフラインでもアプリが起動する')
        ctx.set_offline(False)
        # サブパス上で一連のフロー（手入力 → 保存 → PDF）
        page.get_by_role('button', name='＋ 絵本を追加', exact=True).click()
        page.click('summary:has-text("ISBNを手入力")')
        page.fill('[data-testid=isbn-input]', ISBN2)
        page.click('button:has-text("検索")')
        wait_detail_ready(page)
        page.get_by_role('button', name='保存', exact=True).click(); page.wait_for_selector('.book-card')
        page.get_by_role('button', name='PDFを作成', exact=True).click(); page.wait_for_selector('[data-testid=sheet]')
        page.click('[data-testid=make-pdf]'); page.wait_for_selector('[data-testid=pdf-link]')
        check(True, '本番ビルド上でも 追加→保存→PDF 作成まで動く')
        page.goto(PREVIEW + 'screens.html')
        page.wait_for_selector('#s-crop .crop-viewport')
        page.wait_for_timeout(500)
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.screenshot(path=os.path.join(OUT, '11_screens_page.png'), full_page=True)
        check(page.locator('figure').count() == 6, '画面確認ページに6画面が並ぶ')
        check(not page.errors, 'C: コンソールエラーなし ' + str(page.errors))
        ctx.close(); br.close()

def verify_pdf(path, n_books):
    print('\n--- PDF 検証 ---')
    info = subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
    m = re.search(r'Page size:\s+([\d.]+) x ([\d.]+) pts', info)
    w, h = float(m.group(1)), float(m.group(2))
    check(abs(w - 595.276) < 0.1 and abs(h - 841.89) < 0.1, f'用紙は A4 縦 ({w} x {h} pt)')
    data = open(path, 'rb').read().decode('latin1')
    cms = re.findall(r'q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm /Im\d+ Do Q', data)
    check(len(cms) == n_books, f'画像が {len(cms)} 枚配置されている')
    check(all(abs(float(a) - 70.866) < 0.002 and abs(float(b) - 70.866) < 0.002 for a, b, _, _ in cms), '各画像は 70.866pt = 25.000mm 角')
    # レンダリングして実寸（10px/mm @254dpi）を測る
    subprocess.run(['pdftoppm', '-r', '254', '-png', '-singlefile', path, os.path.join(OUT, 'labels_render')], check=True)
    im = Image.open(os.path.join(OUT, 'labels_render.png')).convert('RGB')
    check(abs(im.width - 2100) <= 2 and abs(im.height - 2970) <= 2, f'254dpi 描画で {im.width}x{im.height}px（=210x297mm）')
    px = im.load()
    xs, ys = [], []
    for y in range(130, 420):
        for x in range(100, 390):
            r, g, b = px[x, y]
            if max(r, g, b) - min(r, g, b) > 60:
                xs.append(x); ys.append(y)
    bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    check(abs(bw - 250) <= 2 and abs(bh - 250) <= 2, f'1枚目の実測サイズ {bw/10:.1f} x {bh/10:.1f} mm（期待 25 x 25）')
    check(abs(min(xs) - 115) <= 2 and abs(min(ys) - 145) <= 2, f'1枚目の位置 左 {min(xs)/10:.1f}mm / 上 {min(ys)/10:.1f}mm（期待 11.5 / 14.5）')
    # 隣のラベルとの間隔: 横ピッチ 27mm（25mm + 2mm）= 76.535pt
    xs_pt = sorted({float(c[2]) for c in cms})
    if len(xs_pt) >= 2:
        check(abs((xs_pt[1] - xs_pt[0]) - 27 * 72 / 25.4) < 0.01, f'ラベルの横ピッチ {(xs_pt[1] - xs_pt[0]) / 72 * 25.4:.3f}mm（25mm + 余白2mm）')

if __name__ == '__main__':
    run()
    print('\n' + ('すべて合格' if not fails else f'{len(fails)} 件失敗:\n  - ' + '\n  - '.join(fails)))
    sys.exit(1 if fails else 0)
