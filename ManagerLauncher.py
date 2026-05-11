import os
import sys
import threading
import http.server
import socketserver
import webview
import winreg
import ctypes
import shutil
import subprocess

def check_single_instance():
    """이미 프로그램이 실행 중인지 확인합니다."""
    mutex_name = "Global\\LicenseFlowManager_SingleInstance_Mutex"
    ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
    if ctypes.windll.kernel32.GetLastError() == 183: # ERROR_ALREADY_EXISTS
        return False
    return True

def get_base_path():
    """실행 파일(EXE) 또는 스크립트의 실제 위치를 반환합니다."""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def self_install_and_cleanup():
    """자가 설치 및 구버전 찌꺼기 청소 로직"""
    if not getattr(sys, 'frozen', False): return # 개발 환경 제외

    current_exe = sys.executable
    app_name = "LicenseFlow_Manager"
    install_dir = os.path.join(os.environ['LOCALAPPDATA'], app_name)
    target_exe = os.path.join(install_dir, f"{app_name}.exe")

    # 1. 구버전 레지스트리 싹 청소 (중복 실행 방지)
    try:
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS) as reg_key:
            old_names = ["LicenseFlow", "LicenseFlow Launcher", "ManagerLauncher", "LicenseFlowManager"]
            for old in old_names:
                try: winreg.DeleteValue(reg_key, old)
                except FileNotFoundError: pass
            # 현재 정식 이름으로 등록
            winreg.SetValueEx(reg_key, app_name, 0, winreg.REG_SZ, f'"{target_exe}"')
    except Exception: pass

    # 2. 자가 설치 (설치 폴더가 아니면 이동)
    if os.path.abspath(current_exe).lower() != os.path.abspath(target_exe).lower():
        try:
            if not os.path.exists(install_dir): os.makedirs(install_dir)
            # 기존 파일이 있으면 종료 후 교체 시도 (이미 실행 중일 수 있으므로)
            shutil.copy2(current_exe, target_exe)
            
            # 바탕화면 바로가기 생성 (PowerShell 이용)
            shortcut_path = os.path.join(os.path.expanduser("~"), "Desktop", "LicenseFlow Manager.lnk")
            ps_script = f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{shortcut_path}');$s.TargetPath='{target_exe}';$s.WorkingDirectory='{install_dir}';$s.Save()"
            subprocess.run(["powershell", "-Command", ps_script], capture_output=True)
            
            # 설치된 파일 실행 후 현재(임시) 파일 종료
            os.startfile(target_exe)
            sys.exit(0)
        except Exception as e:
            print(f"Install error: {e}")

def start_local_server(port, directory):
    """정적 파일 서버 실행"""
    os.chdir(directory)
    handler = http.server.SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", port), handler) as httpd:
            httpd.serve_forever()
    except Exception: pass

def run_manager():
    # 0. 중복 실행 방지
    if not check_single_instance():
        sys.exit(0)

    # 1. 자가 설치 및 청소 (배치 파일 없이도 스스로 해결)
    self_install_and_cleanup()

    # 2. 경로 설정
    base_path = get_base_path()
    dist_path = os.path.join(base_path, "dist")
    
    if not os.path.exists(dist_path):
        exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.getcwd()
        dist_path = os.path.join(exe_dir, "dist")

    if not os.path.exists(dist_path): return

    # 3. 서버 시작
    port = 55771 
    threading.Thread(target=start_local_server, args=(port, dist_path), daemon=True).start()

    # 4. 브라우저 창 (v1.1.0)
    webview.create_window('LicenseFlow Manager v1.1.0', f'http://localhost:{port}', width=1280, height=720)
    webview.start()

if __name__ == '__main__':
    run_manager()
