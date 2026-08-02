
import sys
import os
import webbrowser
from threading import Timer

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
def open_browser():
    webbrowser.open_new("http://127.0.0.1:12457/")
if __name__ == '__main__':
    try:
        import app
        Timer(1, open_browser).start()
        app.app.run(
            debug=False,
            use_reloader=False,
            port=12457,
            host="127.0.0.1"
        )

    except Exception as e:
        print(f"启动失败：{e}")
        import traceback
        traceback.print_exc()
        input("\n按回车退出")
        sys.exit(1)
