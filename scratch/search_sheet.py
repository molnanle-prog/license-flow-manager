import gspread
from oauth2client.service_account import ServiceAccountCredentials
import json

SERVICE_ACCOUNT_INFO = {
  "type": "service_account",
  "private_key": r"""-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\xdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\n6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----""",
  "client_email": "license-admin@license-manager-485501.iam.gserviceaccount.com",
  "token_uri": "https://oauth2.googleapis.com/token"
}

def get_google_client():
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    
    # Replace raw string "\n" with actual newlines for standard oauth2client processing
    creds_dict = SERVICE_ACCOUNT_INFO.copy()
    creds_dict["private_key"] = creds_dict["private_key"].replace(r"\n", "\n")
    
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    return gspread.authorize(creds)

def search_sheets():
    sheet_ids = {
        "EzImpo": "1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ",
        "EzPrintWork": "1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0"
    }
    
    keywords = ["김형중", "2615-3362", "26153362", "8C4ADAB8DA5F537D3BB851FE4FEED2F9"]
    
    client = get_google_client()
    
    for prog, sheet_id in sheet_ids.items():
        print(f"=== Checking {prog} ({sheet_id}) ===")
        sheet = client.open_by_key(sheet_id)
        
        # Check Licenses sheet
        try:
            ws_lic = sheet.worksheet("Licenses")
            lics = ws_lic.get_all_values()
            print(f"Licenses total rows: {len(lics)}")
            for idx, row in enumerate(lics):
                row_str = " | ".join(row)
                if any(k in row_str for k in keywords):
                    print(f"  [Licenses Row {idx+1}]: {row_str}")
        except Exception as e:
            print(f"  Licenses error: {e}")
            
        # Check InstallLogs sheet
        try:
            ws_log = sheet.worksheet("InstallLogs")
            logs = ws_log.get_all_values()
            print(f"InstallLogs total rows: {len(logs)}")
            for idx, row in enumerate(logs):
                row_str = " | ".join(row)
                if any(k in row_str for k in keywords):
                    print(f"  [InstallLogs Row {idx+1}]: {row_str}")
        except Exception as e:
            print(f"  InstallLogs error: {e}")
            
if __name__ == "__main__":
    search_sheets()
