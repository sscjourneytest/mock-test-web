import os

old_text = '<meta name="viewport" content="width=1100">'
new_text = '<meta name="viewport" content="width=800">'

for root, dirs, files in os.walk("."):
    for file in files:
        if file == "index.html":
            file_path = os.path.join(root, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            if old_text in content:
                new_content = content.replace(old_text, new_text)
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated: {file_path}")
