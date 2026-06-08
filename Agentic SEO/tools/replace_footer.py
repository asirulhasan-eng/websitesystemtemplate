import os, glob

target_dir = r'd:\Projects\{{NICHE}} SEO Agency'
html_files = glob.glob(os.path.join(target_dir, '**', '*.html'), recursive=True)

target_str = '''          <div style="margin-top:var(--space-4);">
            <div style="font-size:var(--text-xs);color:rgba(250,250,247,0.65);margin-bottom:var(--space-1);text-transform:uppercase;letter-spacing:0.05em;">Email us</div>
            <a href="mailto:hello@{{DOMAIN}}" class="footer__link" style="font-size:var(--text-sm);">hello@{{DOMAIN}}</a>
          </div>
        </div>'''

replacement_str = '''          <div style="margin-top:var(--space-4);">
            <div style="font-size:var(--text-xs);color:rgba(250,250,247,0.65);margin-bottom:var(--space-1);text-transform:uppercase;letter-spacing:0.05em;">Email us</div>
            <a href="mailto:hello@{{DOMAIN}}" class="footer__link" style="font-size:var(--text-sm);">hello@{{DOMAIN}}</a>
          </div>
          <div style="margin-top:var(--space-4);">
            <div style="font-size:var(--text-xs);color:rgba(250,250,247,0.65);margin-bottom:var(--space-1);text-transform:uppercase;letter-spacing:0.05em;">Headquarters</div>
            <p style="font-size:var(--text-sm);color:rgba(250,250,247,0.75);margin:0;">Co Rd V, Childress , TX 79201, US</p>
          </div>
        </div>'''

count = 0
for filepath in html_files:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if target_str in content:
        content = content.replace(target_str, replacement_str)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        count += 1
        
print(f'Replaced in {count} files.')
