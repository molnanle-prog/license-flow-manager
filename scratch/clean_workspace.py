
import os
import shutil

project_root = r'C:\Users\CEO\Desktop\라이선스-플로우-매니저(메일-보내기-기능-업그레이드)'

# List of items to remove if found as children of project_root
bad_items = ['c:', 'C:', 'c;', 'C;']

for item in bad_items:
    item_path = os.path.join(project_root, item)
    if os.path.exists(item_path):
        print(f"Found bad item: {item_path}")
        try:
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)
                print(f"Successfully deleted directory: {item_path}")
            else:
                os.remove(item_path)
                print(f"Successfully deleted file: {item_path}")
        except Exception as e:
            print(f"Failed to delete {item_path}: {e}")

print("Cleanup complete.")
