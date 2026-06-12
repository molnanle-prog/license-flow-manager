import os
import sys
import json
import threading
import http.server
import socketserver
import webview
import webbrowser
import winreg
import ctypes
import shutil
import subprocess

APP_NAME = "LicenseFlow_Manager"
AUTH_HANDOFF = {}
LOGIN_WINDOW = None


def close_login_window():
    """로그인 handoff 완료 후 Google 로그인 창 닫기"""
    global LOGIN_WINDOW
    win = LOGIN_WINDOW
    LOGIN_WINDOW = None
    if win is None:
        return
    try:
        win.destroy()
    except Exception:
        pass


def get_install_dir():
    return os.path.join(os.environ["LOCALAPPDATA"], APP_NAME)


def get_secrets_path():
    return os.path.join(get_install_dir(), "manager-secrets.json")


def ensure_secrets_template(dist_path):
    """AppData에 manager-secrets.json 템플릿 생성 (최초 1회)"""
    install_dir = get_install_dir()
    secrets_path = get_secrets_path()
    if os.path.isfile(secrets_path):
        return secrets_path

    os.makedirs(install_dir, exist_ok=True)
    candidates = [
        os.path.join(dist_path, "manager-secrets.json"),
        os.path.join(dist_path, "manager-secrets.example.json"),
    ]
    for src in candidates:
        if os.path.isfile(src):
            shutil.copy2(src, secrets_path)
            return secrets_path
    return secrets_path


class ManagerHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """dist 정적 파일 + manager-secrets.json + Google 로그인 토큰 handoff"""

    secrets_path = None

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        path_only = self.path.split("?", 1)[0]
        if path_only == "/__auth/handoff":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                AUTH_HANDOFF["tokens"] = json.loads(body.decode("utf-8"))
            except Exception:
                AUTH_HANDOFF["tokens"] = {}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            close_login_window()
            return
        self.send_error(404)

    def do_DELETE(self):
        path_only = self.path.split("?", 1)[0]
        if path_only == "/__auth/handoff":
            AUTH_HANDOFF.clear()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def guess_type(self, path):
        ctype = super().guess_type(path)
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        if path.endswith(".json"):
            return "application/json; charset=utf-8"
        return ctype

    def do_GET(self):
        path_only = self.path.split("?", 1)[0]
        if path_only == "/__auth/handoff":
            payload = AUTH_HANDOFF.get("tokens") or {}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8"))
            return
        if path_only in ("/manager-secrets.json", "/manager-secrets.example.json"):
            target = self.secrets_path if path_only == "/manager-secrets.json" else None
            if target and os.path.isfile(target):
                try:
                    with open(target, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                except OSError:
                    pass
            if path_only == "/manager-secrets.json":
                self.send_error(404, "manager-secrets.json not configured")
                return
        return super().do_GET()

    def log_message(self, format, *args):
        return


def check_single_instance():
    """이미 프로그램이 실행 중인지 확인합니다."""
    mutex_name = "Global\\LicenseFlowManager_SingleInstance_Mutex"
    ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        return False
    return True


def get_base_path():
    """실행 파일(EXE) 또는 스크립트의 실제 위치를 반환합니다."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def self_install_and_cleanup():
    """자가 설치 및 구버전 찌꺼기 청소 로직"""
    if not getattr(sys, "frozen", False):
        return

    current_exe = sys.executable
    install_dir = get_install_dir()
    target_exe = os.path.join(install_dir, f"{APP_NAME}.exe")

    try:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS) as reg_key:
            old_names = ["LicenseFlow", "LicenseFlow Launcher", "ManagerLauncher", "LicenseFlowManager"]
            for old in old_names:
                try:
                    winreg.DeleteValue(reg_key, old)
                except FileNotFoundError:
                    pass
            winreg.SetValueEx(reg_key, APP_NAME, 0, winreg.REG_SZ, f'"{target_exe}"')
    except Exception:
        pass

    if os.path.abspath(current_exe).lower() != os.path.abspath(target_exe).lower():
        try:
            if not os.path.exists(install_dir):
                os.makedirs(install_dir)
            shutil.copy2(current_exe, target_exe)

            shortcut_path = os.path.join(os.path.expanduser("~"), "Desktop", "LicenseFlow Manager.lnk")
            ps_script = (
                f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{shortcut_path}');"
                f"$s.TargetPath='{target_exe}';$s.WorkingDirectory='{install_dir}';$s.Save()"
            )
            subprocess.run(["powershell", "-Command", ps_script], capture_output=True)
            os.startfile(target_exe)
            sys.exit(0)
        except Exception as e:
            print(f"Install error: {e}")


def start_local_server(port, directory, secrets_path):
    """정적 파일 서버 실행"""
    handler_cls = ManagerHTTPRequestHandler
    handler_cls.secrets_path = secrets_path

    class Handler(handler_cls):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", port), Handler) as httpd:
            httpd.serve_forever()
    except Exception:
        pass


class DesktopApi:
    def __init__(self, port):
        self.port = port

    def open_browser_login(self):
        """Google 로그인 전용 작은 창 (완료 시 자동 닫힘)"""
        global LOGIN_WINDOW
        AUTH_HANDOFF.clear()
        url = f"http://localhost:{self.port}/login-helper.html"

        if LOGIN_WINDOW is not None:
            try:
                LOGIN_WINDOW.load_url(url)
                LOGIN_WINDOW.show()
                return True
            except Exception:
                LOGIN_WINDOW = None

        LOGIN_WINDOW = webview.create_window(
            "LicenseFlow - Google Login",
            url,
            width=480,
            height=560,
            resizable=False,
            on_top=True,
        )
        return True


def run_manager():
    if not check_single_instance():
        sys.exit(0)

    self_install_and_cleanup()

    base_path = get_base_path()
    dist_path = os.path.join(base_path, "dist")

    if not os.path.exists(dist_path):
        exe_dir = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.getcwd()
        dist_path = os.path.join(exe_dir, "dist")

    if not os.path.exists(dist_path):
        return

    secrets_path = ensure_secrets_template(dist_path)

    port = 55771
    threading.Thread(
        target=start_local_server,
        args=(port, dist_path, secrets_path),
        daemon=True,
    ).start()

    api = DesktopApi(port)
    webview.create_window(
        "LicenseFlow Manager v1.1.0",
        f"http://localhost:{port}",
        width=1280,
        height=720,
        js_api=api,
    )
    webview.start(private_mode=False)


if __name__ == "__main__":
    run_manager()
