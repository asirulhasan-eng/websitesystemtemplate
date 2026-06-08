const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            walkDir(dirPath, callback);
        } else {
            callback(dirPath);
        }
    });
}

const targetDir = 'd:\\Projects\\{{NICHE}} SEO Agency';

const targetRegex = /hello@client\.agency<\/a>\s*<\/div>\s*<\/div>\s*<\/div>\s*<!-- Footer Bottom Bar -->/g;

const replacementStr = `hello@{{DOMAIN}}</a>
          </div>
          <div style="margin-top:var(--space-4);">
            <div style="font-size:var(--text-xs);color:rgba(250,250,247,0.65);margin-bottom:var(--space-1);text-transform:uppercase;letter-spacing:0.05em;">Headquarters</div>
            <p style="font-size:var(--text-sm);color:rgba(250,250,247,0.75);margin:0;">Co Rd V, Childress , TX 79201, US</p>
          </div>
        </div>
      </div>

      <!-- Footer Bottom Bar -->`;

let count = 0;

walkDir(targetDir, (filePath) => {
    if (filePath.endsWith('.html')) {
        let content = fs.readFileSync(filePath, 'utf8');
        // Let's use a simple replace that handles potential whitespace differences
        const regex = /hello@client\.agency<\/a>\s*<\/div>\s*<\/div>\s*<\/div>\s*<!-- Footer Bottom Bar -->/;
        if (regex.test(content)) {
            content = content.replace(regex, replacementStr);
            fs.writeFileSync(filePath, content, 'utf8');
            count++;
        }
    }
});

console.log(`Replaced in ${count} files.`);
