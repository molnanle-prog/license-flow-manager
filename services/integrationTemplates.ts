
import { Product } from "../types";

export const getReactTemplate = (product: Product | null) => {
  return `// React 연동 예제는 Wrapper 방식에서는 필요 없습니다.`;
};

export const getHtmlTemplate = (product: Product | null) => {
  return `<!-- HTML 연동 예제는 Wrapper 방식에서는 필요 없습니다. -->`;
};

export const getPythonTemplate = (product: Product | null) => {
    return `# Python 직접 연동 예제는 Wrapper 방식에서는 필요 없습니다.`;
};

// --- NEW: Universal Wrapper Launcher Template (v3.6.6 SafetyPlus Version) ---

export const getUniversalLauncherCode = (privateKey: string, clientEmail: string, gasUrl: string, securityToken: string) => {
  return `# [v3.6.6] 만능 문지기 프로그램 (LicenseGuard.py) - 보안 강화 및 복합 식별자 버전
# 빌드 명령어: pyinstaller --onefile --noconsole --name="LicenseGuard" --add-data "launcher.json;." LicenseGuard.py

import sys
import json
import os
import subprocess
import datetime
import tkinter as tk
from tkinter import messagebox
import uuid
import urllib.request
import urllib.parse
import ssl
import re
import base64
import hashlib
import ctypes
from cryptography.fernet import Fernet

# --- 보안 설정 ---
APPS_SCRIPT_URL = "${gasUrl || '여기에_배포된_GAS_URL을_입력하세요'}"
SECURITY_TOKEN = "${securityToken || 'EzImpo_Secure_Handshake_Token_v3_X9Z'}"

# [SECURITY] Obfuscated Secret Salt (서버와 공유)
def _get_secure_salt():
    base = ["Ez", "Im", "po"]
    mid = hashlib.md5("".join(base).encode()).hexdigest()[:8]
    parts = [mid, "Secure", "Handshake", "v3", "X9Z", "Premium"]
    return "_".join(parts)

SECRET_SALT = _get_secure_salt() 

# 파일 경로 상수
CONFIG_FILE = "launcher.json"
LICENSE_FILE = "license.dat"

def get_machine_id():
    """복합 하드웨어 지문(Composite Fingerprint) 수집 (v3.6.6+)"""
    def _run_cmd(cmd):
        try:
            return subprocess.check_output(cmd, shell=True).decode().split('\\n')[1].strip()
        except:
            return ""

    # 1. 메인보드 UUID (저가형 보드 중복 체크)
    mb_uuid = _run_cmd('wmic csproduct get uuid')
    if mb_uuid in ["00000000-0000-0000-0000-000000000000", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"]:
        mb_uuid = "" 
        
    # 2. CPU 고유번호
    cpu_id = _run_cmd('wmic cpu get processorid')
    
    # 3. 디스크 시리얼
    disk_id = _run_cmd('wmic diskdrive where "index=0" get serialnumber')
    
    # 4. MAC 주소
    mac_id = str(uuid.getnode())

    # 모든 정보를 조합하여 하나라도 유니크한 값이 섞이게 함
    raw_id = f"MB:{mb_uuid}|CPU:{cpu_id}|DISK:{disk_id}|MAC:{mac_id}"
    return hashlib.sha256(raw_id.encode()).hexdigest()[:16]

def is_debugger_present():
    try:
        return ctypes.windll.kernel32.IsDebuggerPresent() != 0
    except:
        return False

def get_cipher():
    raw_key = (SECRET_SALT + get_machine_id()).encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(raw_key).digest())
    return Fernet(key)

def encrypt_data(data_dict):
    cipher = get_cipher()
    json_str = json.dumps(data_dict)
    return cipher.encrypt(json_str.encode()).decode()

def decrypt_data(encrypted_str):
    try:
        cipher = get_cipher()
        decrypted_bytes = cipher.decrypt(encrypted_str.encode())
        return json.loads(decrypted_bytes.decode())
    except:
        return None

def load_config():
    base_paths = [getattr(sys, '_MEIPASS', ''), os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else '', os.path.dirname(os.path.abspath(__file__))]
    for bp in base_paths:
        if not bp: continue
        cfg_path = os.path.join(bp, CONFIG_FILE)
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except: pass
    root = tk.Tk(); root.withdraw()
    messagebox.showerror("설정 오류", f"'{CONFIG_FILE}' 파일이 없거나 읽을 수 없습니다.")
    root.destroy(); sys.exit(1)

def run_target_program(target_exe):
    base_path = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
    target_path = os.path.join(base_path, target_exe)
    if not os.path.exists(target_path):
        messagebox.showerror("실행 오류", f"원본 파일({target_exe})을 찾을 수 없습니다.")
        sys.exit(1)
    subprocess.Popen([target_path], cwd=base_path)
    sys.exit(0)

def validate_online(key, pin, user_info, gas_url):
    try:
        payload = {
            "token": SECURITY_TOKEN,
            "key": key,
            "pin": pin,
            "machineId": get_machine_id(),
            "userInfo": user_info,
            "version": PRODUCT_VERSION
        }
        json_data = json.dumps(payload).encode('utf-8')
        headers = {'Content-Type': 'application/json', 'User-Agent': f'EzImpoGuard/{PRODUCT_VERSION} (CompositeID)'}
        req = urllib.request.Request(gas_url, data=json_data, headers=headers)
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        with urllib.request.urlopen(req, context=ctx, timeout=15) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result.get("valid", False), result.get("message", "응답 처리 실패")
    except Exception as e:
        return False, f"서버 통신 오류: {str(e)}"

def check_local_license():
    if not os.path.exists(LICENSE_FILE): return False
    try:
        with open(LICENSE_FILE, 'r') as f:
            data = decrypt_data(f.read().strip())
            if not data or data.get('machineId') != get_machine_id(): return False
            if data.get('key') == 'TEST': return False 
            return data.get('valid', False)
    except: return False

def save_local_license(key, contact, pin):
    save_data = {"key": key, "machineId": get_machine_id(), "last_check": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "valid": True, "contact": contact}
    with open(LICENSE_FILE, 'w') as f: f.write(encrypt_data(save_data))

# --- 실행 로직 ---
config = load_config()
PRODUCT_VERSION = config.get('version', '3.6.6')
TARGET_EXE = config.get('targetExecutable')
PRODUCT_NAME = config.get('productName', 'My App')
GAS_URL = config.get('gasUrl', APPS_SCRIPT_URL)

if is_debugger_present():
    messagebox.showerror("보안 경고", "비정상적인 실행 환경이 감지되었습니다.")
    sys.exit(1)

if check_local_license():
    run_target_program(TARGET_EXE)

root = tk.Tk()
root.title(f"{PRODUCT_NAME} - 라이선스 인증")
root.geometry("400x520"); root.resizable(False, False)

tk.Label(root, text=f"{PRODUCT_NAME}", font=("Malgun Gothic", 10)).pack(pady=(20, 5))
tk.Label(root, text="제품 라이선스 인증", font=("Malgun Gothic", 16, "bold")).pack(pady=(0, 20))

frame = tk.Frame(root, padx=25); frame.pack(fill="both")

tk.Label(frame, text="라이선스 키").pack(anchor="w")
entry_key = tk.Entry(frame, font=("Arial", 10)); entry_key.pack(fill="x", pady=(0, 10))

tk.Label(frame, text="PIN 번호").pack(anchor="w")
entry_pin = tk.Entry(frame, show="*", font=("Arial", 10)); entry_pin.pack(fill="x", pady=(0, 10))

tk.Label(frame, text="--- 본인 확인용 정보 (기기 교체/업그레이드 대응) ---", fg="#6366f1", font=("Malgun Gothic", 8, "bold")).pack(pady=10)
tk.Label(frame, text="상호명 / 성명").pack(anchor="w")
u_frame = tk.Frame(frame); u_frame.pack(fill="x", pady=(0, 5))
entry_comp = tk.Entry(u_frame, width=15); entry_comp.pack(side="left", fill="x", expand=True, padx=(0,2))
entry_name = tk.Entry(u_frame, width=15); entry_name.pack(side="left", fill="x", expand=True, padx=(2,0))

tk.Label(frame, text="연락처 (등록 정보와 일치해야 자동 승인 가능)").pack(anchor="w")
entry_contact = tk.Entry(frame, font=("Arial", 10)); entry_contact.insert(0, "010-"); entry_contact.pack(fill="x", pady=(2, 20))

def on_submit():
    key = entry_key.get().strip().upper()
    pin = entry_pin.get().strip()
    if not key or not pin:
        messagebox.showwarning("주의", "키와 PIN을 입력하세요."); return
    btn_submit.config(state="disabled", text="통신 중...")
    root.update()
    u_info = {"company": entry_comp.get(), "name": entry_name.get(), "contact": entry_contact.get()}
    v, m = validate_online(key, pin, u_info, GAS_URL)
    if v:
        save_local_license(key, entry_contact.get(), pin)
        messagebox.showinfo("완료", m); root.destroy(); run_target_program(TARGET_EXE)
    else:
        btn_submit.config(state="normal", text="인증하기"); messagebox.showerror("실패", m)

btn_submit = tk.Button(root, text="인증하기", bg="#4f46e5", fg="white", font=("Malgun Gothic", 12, "bold"), command=on_submit)
btn_submit.pack(fill="x", padx=25, pady=10)
tk.Label(root, text="Security Hardened v3.6.6 (Composite ID Mode)", fg="gray", font=("Arial", 8)).pack(side="bottom", pady=5)
root.mainloop()
`;
};

export const getLauncherConfigJSON = (product: Product | null, programSheetId: string, gasUrl: string) => {
    const productName = product ? product.name : "My Product Name";
    const targetExe = product ? `${product.name.replace(/\s+/g, '')}.exe` : "MyOriginalApp.exe";
    const version = product ? product.version : "1.0.0";
    
    return JSON.stringify({
        "productName": productName,
        "version": version,
        "sheetId": programSheetId,
        "gasUrl": gasUrl || "여기에_배포된_GAS_URL을_입력하세요",
        "targetExecutable": targetExe
    }, null, 2);
};
