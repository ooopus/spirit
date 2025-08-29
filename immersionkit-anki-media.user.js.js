// ==UserScript==
// @name         Immersion Kit 媒体补充工具
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  在 Immersion Kit 网站上为每个结果添加按钮，用于将图片或音频补充到最新添加的 Anki 卡片中。可通过 Tampermonkey 菜单进行配置。
// @author       Your Name
// @match        https://www.immersionkit.com/dictionary*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=immersionkit.com
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_addElement
// ==/UserScript==

(async function() {
    'use strict';

    // --- 1. 配置模块 ---
    const config = {
        data: {},
        defaults: {
            ANKI_FIELD_FOR_IMAGE: 'Picture',
            ANKI_FIELD_FOR_AUDIO: 'SentenceAudio',
            ANKI_CONNECT_URL: 'http://127.0.0.1:8765',
        },
        ui: { container: null },

        async load() {
            const saved = await GM_getValue('immersionKitHelperConfig', {});
            this.data = { ...this.defaults, ...saved };
        },

        async save() {
            const newConfig = {
                ANKI_FIELD_FOR_IMAGE: document.getElementById('cfg-image-field').value.trim(),
                ANKI_FIELD_FOR_AUDIO: document.getElementById('cfg-audio-field').value.trim(),
                ANKI_CONNECT_URL: document.getElementById('cfg-anki-url').value.trim(),
            };
            await GM_setValue('immersionKitHelperConfig', newConfig);
            this.data = newConfig;
            alert('配置已保存！建议刷新页面以应用新设置。');
            this.hideUI();
        },

        showUI() {
            if (this.ui.container) return;

            GM_addStyle(`
                #ik-config-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0,0,0,0.5); z-index: 9998; }
                #ik-config-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; border-radius: 8px; padding: 20px 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 9999; width: 420px; font-family: sans-serif; }
                #ik-config-panel h3 { margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                #ik-config-panel .form-group { margin-bottom: 15px; }
                #ik-config-panel label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px; }
                #ik-config-panel input { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
                #ik-config-panel .buttons { text-align: right; margin-top: 20px; }
                #ik-config-panel button { padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px; font-weight: bold; }
                #ik-config-panel .btn-save { background-color: #28a745; color: white; }
                #ik-config-panel .btn-cancel { background-color: #6c757d; color: white; }
            `);

            this.ui.container = GM_addElement(document.body, 'div');
            this.ui.container.innerHTML = `
                <div id="ik-config-backdrop"></div>
                <div id="ik-config-panel">
                    <h3>Immersion Kit 助手配置</h3>
                    <div class="form-group"><label for="cfg-image-field">图片字段名</label><input type="text" id="cfg-image-field" value="${this.data.ANKI_FIELD_FOR_IMAGE}"></div>
                    <div class="form-group"><label for="cfg-audio-field">音频字段名</label><input type="text" id="cfg-audio-field" value="${this.data.ANKI_FIELD_FOR_AUDIO}"></div>
                    <div class="form-group"><label for="cfg-anki-url">AnkiConnect URL</label><input type="text" id="cfg-anki-url" value="${this.data.ANKI_CONNECT_URL}"></div>
                    <div class="buttons"><button id="cfg-btn-cancel" class="btn-cancel">取消</button><button id="cfg-btn-save" class="btn-save">保存</button></div>
                </div>
            `;

            document.getElementById('cfg-btn-save').onclick = () => this.save();
            document.getElementById('cfg-btn-cancel').onclick = () => this.hideUI();
            document.getElementById('ik-config-backdrop').onclick = () => this.hideUI();
        },

        hideUI() {
            if (this.ui.container) {
                this.ui.container.remove();
                this.ui.container = null;
            }
        }
    };

    // --- 2. AnkiConnect 核心函数 ---
    function invokeAnkiConnect(action, params = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: config.data.ANKI_CONNECT_URL,
                data: JSON.stringify({ action, version: 6, params }),
                headers: { 'Content-Type': 'application/json' },
                onload: res => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) reject(new Error(data.error));
                        else resolve(data.result);
                    } catch (e) { reject(new Error('解析 AnkiConnect 响应失败')); }
                },
                onerror: () => reject(new Error('连接 AnkiConnect 失败，请检查 Anki 是否运行'))
            });
        });
    }

    // --- 3. 辅助函数与常量 ---
    const SCRIPT_NAME = '[ImmersionKit Helper]';
    let processedItems = new WeakSet();
    let debounceTimer = null;

    function updateButtonState(button, state, message = '') {
        const states = {
            loading: { color: 'orange', icon: 'hourglass half', text: '处理中...' },
            success: { color: 'green', icon: 'check circle', text: '已添加!' },
            error: { color: 'red', icon: 'times circle', text: '错误!' }
        };
        const s = states[state];
        if (s) {
            button.innerHTML = `<div style="color: ${s.color};"><i class="${s.icon} icon"></i>${message || s.text}</div>`;
            if (state === 'success') button.style.pointerEvents = 'none';
        }
    }

    async function handleButtonClick(event, button, mediaType, mediaUrl, fieldName) {
        event.preventDefault();
        const originalContent = button.innerHTML;
        updateButtonState(button, 'loading');

        try {
            const recentCards = await invokeAnkiConnect('findCards', { query: 'added:1' });
            if (!recentCards.length) throw new Error('找不到最近24小时内添加的卡片');

            const [noteId] = await invokeAnkiConnect('cardsToNotes', { cards: [Math.max(...recentCards)] });
            if (!noteId) throw new Error('无法找到对应的笔记');

            const [noteInfo] = await invokeAnkiConnect('notesInfo', { notes: [noteId] });
            if (typeof noteInfo.fields[fieldName] === 'undefined') throw new Error(`模板中找不到字段: "${fieldName}"`);

            const timestamp = Date.now();
            const extension = mediaType === 'picture' ? 'jpg' : 'mp3';
            const filename = `immersionkit_${mediaType}_${timestamp}.${extension}`;
            const mediaObject = { url: mediaUrl, filename, fields: [fieldName] };

            await invokeAnkiConnect('updateNoteFields', { note: { id: noteId, fields: {}, [mediaType]: [mediaObject] } });
            console.log(`${SCRIPT_NAME} 成功添加 ${mediaType}: ${filename}`);
            updateButtonState(button, 'success');
        } catch (error) {
            console.error(`${SCRIPT_NAME} 操作失败:`, error);
            updateButtonState(button, 'error');
            alert(`操作失败:\n${error.message}`);
            setTimeout(() => { button.innerHTML = originalContent; }, 5000);
        }
    }

    // --- 4. DOM 处理与主逻辑 ---
    function processItem(item) {
        const menuContainer = item.nextElementSibling?.querySelector('.ui.secondary.menu');
        if (!menuContainer || menuContainer.querySelector('.anki-image-button')) return;

        const imageEl = item.querySelector('.image img');
        const imageUrl = imageEl ? imageEl.src : null;
        if (!imageUrl) return;

        const audioUrl = imageUrl.replace(/\.(jpg|jpeg|png|webp)$/i, '.mp3');

        const imageButton = document.createElement('a');
        imageButton.className = 'item anki-image-button';
        imageButton.innerHTML = `<div style="color: teal;"><i class="image icon"></i>添加图片</div>`;
        imageButton.style.cursor = 'pointer';
        imageButton.onclick = (e) => handleButtonClick(e, imageButton, 'picture', imageUrl, config.data.ANKI_FIELD_FOR_IMAGE);

        const audioButton = document.createElement('a');
        audioButton.className = 'item anki-audio-button';
        audioButton.innerHTML = `<div style="color: teal;"><i class="music icon"></i>添加音频</div>`;
        audioButton.style.cursor = 'pointer';
        audioButton.onclick = (e) => handleButtonClick(e, audioButton, 'audio', audioUrl, config.data.ANKI_FIELD_FOR_AUDIO);

        menuContainer.appendChild(imageButton);
        menuContainer.appendChild(audioButton);
    }

    function scanAndAddButtons() {
        document.querySelectorAll('.ui.divided.items > div.item').forEach(item => {
            if (!processedItems.has(item)) {
                processItem(item);
                processedItems.add(item);
            }
        });
    }

    // --- 5. 启动脚本 ---
    async function init() {
        await config.load();
        GM_registerMenuCommand('配置 Immersion Kit 助手', () => config.showUI());

        try {
            const permission = await invokeAnkiConnect('requestPermission');
            if (permission.permission !== 'granted') throw new Error('AnkiConnect 未授权');
            console.log(`${SCRIPT_NAME} AnkiConnect 连接成功`);
        } catch (error) {
            alert(error.message);
            return;
        }

        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(scanAndAddButtons, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(scanAndAddButtons, 1500); // 初始扫描
    }

    init();

})();