
import os

search_root = r'C:\Users\CEO\Desktop'
target_file = 'index.css'

matches = []
for root, dirs, files in os.walk(search_root):
    if target_file in files:
        matches.append(os.path.join(root, target_file))

for m in matches:
    print(m)
