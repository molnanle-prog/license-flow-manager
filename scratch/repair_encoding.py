
import os

file_path = r'c:\Users\CEO\Desktop\라이선스-플로우-매니저(메일-보내기-기능-업그레이드)\components\LicenseManager.tsx'

# Try to read with different encodings
encodings_to_try = ['cp949', 'euc-kr', 'utf-16', 'latin-1']

content = None
for enc in encodings_to_try:
    try:
        with open(file_path, 'r', encoding=enc) as f:
            content = f.read()
        print(f"Successfully read with {enc}")
        break
    except Exception as e:
        print(f"Failed to read with {enc}: {e}")

if content:
    # Save as UTF-8
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Saved as UTF-8")
else:
    print("Could not read file with any tested encoding")
