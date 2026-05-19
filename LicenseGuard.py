import sys
import json
import os
import subprocess
import datetime
import tkinter as tk
from tkinter import messagebox, ttk
import uuid
import threading
import gspread
import winreg
from oauth2client.service_account import ServiceAccountCredentials
import re

# --- 경로 설정 ---
def get_base_path():
    # 실행 파일(EXE)이 있는 실제 위치
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_PATH = get_base_path()
# license.dat는 항상 EXE 옆에 저장 (사용자 PC 상태 저장용)
LICENSE_FILE = os.path.join(BASE_PATH, "license.dat")

# 외부 설정 파일 경로 (내부에 없을 경우 사용)
EXTERNAL_CONFIG_FILE = os.path.join(BASE_PATH, "launcher.json")

# --- 자동 실행 등록 ---
def add_to_startup():
    """현재 실행 파일을 윈도우 시작 프로그램(레지스트리)에 등록합니다."""
    if not getattr(sys, 'frozen', False):
        return # 개발 환경에서는 건너뜀

    try:
        app_path = sys.executable
        app_name = "LicenseFlow_Manager" # 레지스트리에 등록될 이름
        
        key = winreg.HKEY_CURRENT_USER
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        
        with winreg.OpenKey(key, key_path, 0, winreg.KEY_SET_VALUE) as reg_key:
            winreg.SetValueEx(reg_key, app_name, 0, winreg.REG_SZ, app_path)
            print(f"Startup registered: {app_path}")
    except Exception as e:
        print(f"Failed to register startup: {e}")

# --- 관리자 설정 (빌드 시 고정됨) ---
SERVICE_ACCOUNT_INFO = {
  "private_key": """-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----""",
  "client_email": "license-admin@license-manager-485501.iam.gserviceaccount.com",
  "token_uri": "https://oauth2.googleapis.com/token"
}

def get_stable_machine_id():
    return str(uuid.getnode())

def load_config():
    # 1. [우선] EXE 내부에 포함된 설정 파일 확인 (PyInstaller _MEIPASS)
    if hasattr(sys, '_MEIPASS'):
        bundled_config = os.path.join(sys._MEIPASS, "launcher.json")
        if os.path.exists(bundled_config):
            try:
                with open(bundled_config, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except: pass

    # 2. [차순] EXE 옆에 있는 외부 설정 파일 확인
    if not os.path.exists(EXTERNAL_CONFIG_FILE):
        # 기본값 반환 (오류 방지)
        return {"productName": "LicenseGuard", "version": "1.0.0", "targetExecutable": ""}
    
    try:
        with open(EXTERNAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {"productName": "LicenseGuard", "version": "1.0.0", "targetExecutable": ""}

def run_target_program(target_exe):
    # 원본 프로그램 실행
    target_path = os.path.join(BASE_PATH, target_exe)
    if not os.path.exists(target_path):
        # 내부 리소스에서 찾기 시도
        if hasattr(sys, '_MEIPASS'):
            internal_path = os.path.join(sys._MEIPASS, target_exe)
            if os.path.exists(internal_path):
                target_path = internal_path

    if not os.path.exists(target_path):
        messagebox.showerror("실행 오류", f"실행할 원본 파일({target_exe})을 찾을 수 없습니다.")
        sys.exit(1)

    subprocess.Popen([target_path], cwd=BASE_PATH)
    sys.exit(0)

def get_google_client():
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_dict(SERVICE_ACCOUNT_INFO, scope)
    return gspread.authorize(creds)

def register_installation(sheet_id, product_name, version, action_type="LAUNCH", result="SUCCESS", company="", user="", contact=""):
    try:
        client = get_google_client()
        sheet = client.open_by_key(sheet_id)
        
        # 1. [InstallLogs] 시트 업데이트
        try:
            ws = sheet.worksheet("InstallLogs")
            machine_id = get_stable_machine_id()
            timestamp = str(datetime.datetime.now())

            cell = None
            if action_type == "LAUNCH":
                try:
                    cell = ws.find(machine_id, in_column=5)
                except: pass

            if cell and action_type == "LAUNCH":
                row_idx = cell.row
                ws.update_cell(row_idx, 1, timestamp)
                if company:
                    ws.update_cell(row_idx, 2, company)
                if user:
                    ws.update_cell(row_idx, 3, user)
                if contact:
                    ws.update_cell(row_idx, 4, contact)
                ws.update_cell(row_idx, 9, str(version))
                if product_name:
                     ws.update_cell(row_idx, 10, product_name)
            else:
                row_data = [
                    timestamp, company or "", user or "", contact or "", machine_id,
                    action_type, result, "", str(version) if version else "", product_name or ""
                ]
                ws.append_row(row_data)
        except Exception as e:
            print(f"InstallLogs Error: {e}")

        # 2. [Licenses] 시트 업데이트 (버전 정보 동기화)
        try:
            ws_lic = sheet.worksheet("Licenses")
            all_lics = ws_lic.get_all_values()
            if len(all_lics) > 1:
                machine_id = get_stable_machine_id()
                target_row = -1
                for i, row in enumerate(all_lics[1:], start=2):
                    if len(row) >= 5: # 기기 ID가 기입된 E열(index 4)까지만 존재하더라도 매칭될 수 있도록 조건 완화
                        row_mid = row[4].strip() # Column 5
                        row_prod = row[10].strip().lower().replace(" ", "") if len(row) >= 11 else "" # Column 11 (K열)이 비어있거나 생략된 경우 대응
                        clean_prod = product_name.lower().replace(" ", "")
                        if row_mid == machine_id and (row_prod == clean_prod or not row_prod):
                            target_row = i
                            break
                
                if target_row != -1:
                    timestamp = str(datetime.datetime.now())
                    ws_lic.update_cell(target_row, 9, timestamp) # Last Check-in
                    ws_lic.update_cell(target_row, 12, str(version)) # Version
        except Exception as e:
            print(f"License Version Sync Error: {e}")
        
    except Exception as e:
        print(f"Log Error: {e}")

def validate_online(sheet_id, key, pin, user_info, product_name):
    try:
        current_machine_id = get_stable_machine_id()
        client = get_google_client()
        sheet = client.open_by_key(sheet_id)
        ws = sheet.worksheet("Licenses")
        cell = ws.find(key)
        if not cell: return False, "존재하지 않는 라이선스 키입니다.", None
            
        row_idx = cell.row
        row_data = ws.row_values(row_idx)
        def get_col(idx): return row_data[idx] if len(row_data) > idx else ""

        saved_pin = get_col(1)
        saved_machine_id = get_col(4)
        status = get_col(6)
        
        if status != "ACTIVE" and status != "PENDING": return False, f"라이선스 상태가 유효하지 않습니다: {status}", None
        if str(saved_pin) != str(pin): return False, "PIN 번호가 일치하지 않습니다.", None
        
        current_time = str(datetime.datetime.now())
        
        if not saved_machine_id:
            ws.update_cell(row_idx, 5, current_machine_id)
            ws.update_cell(row_idx, 3, user_info['company'])
            ws.update_cell(row_idx, 4, f"{user_info['name']} {user_info['position']}")
            ws.update_cell(row_idx, 7, "ACTIVE")
            ws.update_cell(row_idx, 9, current_time)
            ws.update_cell(row_idx, 12, user_info['version'])
            threading.Thread(target=register_installation, args=(sheet_id, product_name, user_info['version'], "ACTIVATED", "License Activated", user_info['company'], user_info['name'], user_info['contact']), daemon=True).start()
            return True, "인증 성공 (기기 등록됨)", None
            
        if str(saved_machine_id) != current_machine_id: return False, "다른 기기에서 이미 사용 중인 라이선스입니다.", None
        
        ws.update_cell(row_idx, 9, current_time)
        ws.update_cell(row_idx, 12, user_info['version'])
        return True, "인증 성공", None
    except Exception as e: return False, f"서버 연결 오류: {str(e)}", None

def check_local_license():
    if not os.path.exists(LICENSE_FILE): return False
    try:
        with open(LICENSE_FILE, 'r') as f:
            data = json.load(f)
            return data.get('valid', False)
    except: return False

class LicenseGuardApp:
    def __init__(self):
        self.config = load_config()
        self.machine_id = get_stable_machine_id()
        self.root = None

    def start(self):
        SHEET_ID = self.config.get('sheetId')
        TARGET_EXE = self.config.get('targetExecutable')
        PRODUCT_NAME = self.config.get('productName', 'My Software')
        PRODUCT_VERSION = self.config.get('version', '1.0.0')

        if not SHEET_ID:
            messagebox.showerror("설정 오류", "구글 시트 ID가 설정되지 않았습니다.")
            sys.exit(1)

        # 백그라운드에서 실행 기록 남기기
        threading.Thread(target=register_installation, args=(SHEET_ID, PRODUCT_NAME, PRODUCT_VERSION), daemon=True).start()

        # [NEW] 자동 실행 등록 (윈도우 시작 시 실행되도록)
        add_to_startup()

        if check_local_license():
            run_target_program(TARGET_EXE)

        self.show_ui()

    def show_ui(self):
        self.root = tk.Tk()
        self.root.title(f"{self.config.get('productName')} - 인증")
        self.root.geometry("400x500")
        
        tk.Label(self.root, text=self.config.get('productName'), font=("Arial", 16, "bold")).pack(pady=20)
        
        frame = tk.Frame(self.root, padx=20)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="라이선스 키").pack(anchor="w")
        self.entry_key = tk.Entry(frame)
        self.entry_key.pack(fill="x", pady=5)

        tk.Label(frame, text="PIN 번호").pack(anchor="w")
        self.entry_pin = tk.Entry(frame, show="*")
        self.entry_pin.pack(fill="x", pady=5)

        tk.Label(frame, text="회사명").pack(anchor="w", pady=(10, 0))
        self.entry_comp = tk.Entry(frame)
        self.entry_comp.pack(fill="x", pady=5)

        tk.Label(frame, text="사용자 이름").pack(anchor="w")
        self.entry_name = tk.Entry(frame)
        self.entry_name.pack(fill="x", pady=5)

        tk.Label(frame, text="연락처").pack(anchor="w")
        self.entry_contact = tk.Entry(frame)
        self.entry_contact.pack(fill="x", pady=5)

        tk.Button(self.root, text="인증하기", bg="#4f46e5", fg="white", command=self.on_submit).pack(pady=20, padx=20, fill="x")
        
        self.root.mainloop()

    def on_submit(self):
        key = self.entry_key.get()
        pin = self.entry_pin.get()
        user_info = {
            "company": self.entry_comp.get(),
            "name": self.entry_name.get(),
            "position": "",
            "contact": self.entry_contact.get(),
            "version": self.config.get('version', '1.0.0')
        }
        
        valid, msg, expiry = validate_online(self.config['sheetId'], key, pin, user_info, self.config['productName'])
        if valid:
            with open(LICENSE_FILE, 'w') as f:
                json.dump({"key": key, "valid": True}, f)
            messagebox.showinfo("성공", msg)
            self.root.destroy()
            run_target_program(self.config['targetExecutable'])
        else:
            messagebox.showerror("실패", msg)

if __name__ == "__main__":
    app = LicenseGuardApp()
    app.start()
