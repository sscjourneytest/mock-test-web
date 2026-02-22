// 4. TOP BAR STYLES & BRANDING
function setupTopBarStyles() {
    if (document.getElementById('auth-styles')) return;

    // Create Fixed Header HTML
    const header = document.createElement('header');
    header.className = 'fixed-top-bar';
    header.innerHTML = `
        <div class="brand-name">MOCK MATRIX HUB</div>
        <div id="auth-status"></div>
    `;
    document.body.prepend(header);

    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.innerHTML = `
        .fixed-top-bar {
            position: fixed; top: 0; left: 0; right: 0; height: 65px;
            background: white; border-bottom: 2px solid #f1f5f9;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 5%; z-index: 9999; box-shadow: 0 2px 10px rgba(0,0,0,0.03);
        }
        body { padding-top: 65px; }
        .brand-name {
            font-size: 20px; font-weight: 800; color: #1e293b;
            letter-spacing: -0.5px; font-family: 'Inter', sans-serif;
        }
        .top-nav-items { display: flex; align-items: center; gap: 15px; }
        .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 800; }
        .premium { background: #ffd700; color: #000; }
        .free { background: #f1f5f9; color: #64748b; }
        .buy-btn { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white !important; padding: 8px 16px; border-radius: 8px;
            font-weight: 700; text-decoration: none; font-size: 13px;
        }
        .profile-trigger { 
            background: white; border: 1px solid #e2e8f0; padding: 6px 14px; 
            border-radius: 20px; cursor: pointer; font-weight: 600;
        }
        .dropdown-content { 
            display: none; position: absolute; right: 5%; top: 60px; 
            background: white; border: 1px solid #e2e8f0; padding: 15px; 
            border-radius: 12px; width: 240px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
        }
        .dropdown-content.show { display: block; }
        .logout-btn { 
            background: #fee2e2; color: #dc2626; border: none; padding: 10px; 
            border-radius: 8px; width: 100%; cursor: pointer; font-weight: 700; 
        }
        .top-login-btn {
            background: #1e293b; color: white !important; padding: 8px 20px;
            border-radius: 8px; text-decoration: none; font-weight: 600;
        }
    `;
    document.head.appendChild(style);
}
