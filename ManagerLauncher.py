import os
import sys
import json
import threading
import http.server
import socketserver
import urllib.request
import urllib.error
import webview
import winreg
import ctypes
import shutil
import subprocess
import webbrowser

APP_NAME = "LicenseFlow_Manager"
AUTH_HANDOFF = {}
FIREBASE_API_KEY = "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ"


def read_manager_secrets():
    secrets_path = get_secrets_path()
    if not os.path.isfile(secrets_path):
        return None
    try:
        with open(secrets_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def firebase_password_login(email, password):
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={FIREBASE_API_KEY}"
    )
    payload = json.dumps(
        {"email": email, "password": password, "returnSecureToken": True}
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            message = body.get("error", {}).get("message", "LOGIN_FAILED")
        except Exception:
            message = "LOGIN_FAILED"
        return None, message
    except Exception:
        return None, "NETWORK_ERROR"


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
        if path_only == "/__auth/desktop-login":
            secrets = read_manager_secrets() or {}
            email = str(secrets.get("email") or "").strip()
            password = str(secrets.get("password") or "")
            if not email or not password or password == "YOUR_PASSWORD_HERE":
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "ok": False,
                            "error": "MISSING_SECRETS",
                            "message": "manager-secrets.json 설정이 없습니다.",
                        }
                    ).encode("utf-8")
                )
                return

            data, err = firebase_password_login(email, password)
            if err:
                friendly = {
                    "INVALID_LOGIN_CREDENTIALS": "이메일 또는 비밀번호가 맞지 않습니다.",
                    "EMAIL_NOT_FOUND": "Firebase에 등록되지 않은 이메일입니다.",
                    "INVALID_PASSWORD": "비밀번호가 맞지 않습니다.",
                    "OPERATION_NOT_ALLOWED": "Firebase에서 이메일/비밀번호 로그인을 활성화해 주세요.",
                    "TOO_MANY_ATTEMPTS_TRY_LATER": "로그인 시도가 너무 많습니다. 30분 후 다시 시도해 주세요.",
                    "NETWORK_ERROR": "Firebase 서버에 연결하지 못했습니다.",
                }.get(err, err)
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"ok": False, "error": err, "message": friendly}).encode(
                        "utf-8"
                    )
                )
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "ok": True,
                        "email": data.get("email"),
                        "localId": data.get("localId"),
                    }
                ).encode("utf-8")
            )
            return
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
    """시스템 기본 브라우저에서 Google 로그인 (WebView 팝업 차단 회피)"""

    def __init__(self, port):
        self.port = port

    def open_browser_login(self):
        AUTH_HANDOFF.clear()
        url = f"http://localhost:{self.port}/login-helper.html?from=desktop"
        webbrowser.open(url)
        return True


def read_manager_version():
    default = "1.2.9"
    for base in (get_base_path(), os.path.dirname(os.path.abspath(__file__))):
        path = os.path.join(base, "launcher.json")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                version = str(json.load(f).get("version", "")).strip()
                if version:
                    return version
        except Exception:
            pass
    return default


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
    manager_version = read_manager_version()
    webview.create_window(
        f"LicenseFlow Manager v{manager_version}",
        f"http://localhost:{port}",
        width=1280,
        height=720,
        js_api=api,
    )
    webview.start(private_mode=False)


if __name__ == "__main__":
    run_manager()
