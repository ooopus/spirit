// ==UserScript==
// @name         Immersion Kit 媒体补充工具
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 Immersion Kit 网站上为每个结果添加按钮，用于将图片或音频补充到最新添加的 Anki 卡片中
// @author       Your Name
// @match        https://www.immersionkit.com/dictionary*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=immersionkit.com
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置区 ==========
    const CONFIG = {
        ANKI_FIELD_FOR_IMAGE: 'Picture',        // Anki 卡片中用于存储图片的字段名
        ANKI_FIELD_FOR_AUDIO: 'SentenceAudio',  // Anki 卡片中用于存储音频的字段名
        ANKI_CONNECT_URL: 'http://127.0.0.1:8765',
        SCRIPT_NAME: '[ImmersionKit Helper v3.0]',
        DEBOUNCE_DELAY: 500,  // 防抖延迟（毫秒）
        POLL_INTERVAL: 2000,  // 轮询间隔（毫秒）
        INIT_DELAY: 1500      // 初始化延迟（毫秒）
    };

    // ========== AnkiConnect 通信模块 ==========
    class AnkiConnect {
        static async invoke(action, params = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: CONFIG.ANKI_CONNECT_URL,
                    data: JSON.stringify({
                        action,
                        version: 6,
                        params
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.error) {
                                reject(new Error(data.error));
                            } else {
                                resolve(data.result);
                            }
                        } catch (e) {
                            reject(new Error('解析 AnkiConnect 响应失败'));
                        }
                    },
                    onerror: () => {
                        reject(new Error('连接 AnkiConnect 失败。请确保 Anki 已运行并安装了 AnkiConnect 插件'));
                    }
                });
            });
        }

        static async checkConnection() {
            try {
                const result = await this.invoke('requestPermission');
                return result.permission === 'granted';
            } catch (error) {
                console.error(`${CONFIG.SCRIPT_NAME} AnkiConnect 连接检查失败:`, error);
                return false;
            }
        }

        static async getLatestNoteId() {
            // 1. 查找最近24小时内添加的卡片
            const recentCardIds = await this.invoke('findCards', {
                query: 'added:1'
            });

            if (!recentCardIds || recentCardIds.length === 0) {
                throw new Error('找不到过去24小时内添加的卡片');
            }

            // 2. 获取最新的卡片ID
            const latestCardId = Math.max(...recentCardIds);

            // 3. 将卡片ID转换为笔记ID
            const noteIds = await this.invoke('cardsToNotes', {
                cards: [latestCardId]
            });

            if (!noteIds || noteIds.length === 0) {
                throw new Error(`无法找到卡片 ID ${latestCardId} 对应的笔记`);
            }

            return noteIds[0];
        }

        static async validateNoteField(noteId, fieldName) {
            const notesInfo = await this.invoke('notesInfo', {
                notes: [noteId]
            });

            if (!notesInfo || notesInfo.length === 0) {
                throw new Error(`无法获取笔记 ID ${noteId} 的信息`);
            }

            const noteInfo = notesInfo[0];

            if (typeof noteInfo.fields[fieldName] === 'undefined') {
                throw new Error(`卡片模板中找不到名为 "${fieldName}" 的字段`);
            }

            return true;
        }

        static async addMediaToNote(noteId, mediaType, mediaUrl, fieldName) {
            // 生成唯一文件名
            const timestamp = Date.now();
            const extension = mediaType === 'picture' ? 'jpg' : 'mp3';
            const filename = `immersionkit_${mediaType}_${timestamp}.${extension}`;

            // 构建媒体对象
            const mediaObject = {
                url: mediaUrl,
                filename: filename,
                fields: [fieldName]  // 指定要添加到哪个字段
            };

            // 构建更新请求
            // AnkiConnect 会自动下载媒体并添加到指定字段
            const updatePayload = {
                note: {
                    id: noteId,
                    fields: {},  // 必须包含 fields 对象（即使为空）
                    [mediaType]: [mediaObject]  // 'picture' 或 'audio' 属性
                }
            };

            await this.invoke('updateNoteFields', updatePayload);

            return filename;
        }
    }

    // ========== UI 管理模块 ==========
    class UIManager {
        static createButton(type, text, iconClass) {
            const button = document.createElement('a');
            button.className = `item anki-${type}-button`;
            button.innerHTML = `<div style="color: teal;"><i class="${iconClass} icon"></i>${text}</div>`;
            button.style.cursor = 'pointer';
            return button;
        }

        static updateButtonState(button, state, message) {
            const stateConfig = {
                loading: { color: 'orange', icon: 'hourglass half', text: '处理中...' },
                success: { color: 'green', icon: 'check circle', text: '已添加!' },
                error: { color: 'red', icon: 'times circle', text: '错误!' }
            };

            const config = stateConfig[state];
            if (config) {
                button.innerHTML = `<div style="color: ${config.color};"><i class="${config.icon} icon"></i>${message || config.text}</div>`;

                if (state === 'success') {
                    button.style.pointerEvents = 'none';
                }
            }
        }

        static findMenuContainer(item) {
            // 查找下一个兄弟元素中的菜单容器
            return item.nextElementSibling?.querySelector('.ui.secondary.menu');
        }

        static extractMediaUrls(item) {
            const imageElement = item.querySelector('.image img');
            const imageUrl = imageElement ? imageElement.src : null;

            // 根据图片URL推断音频URL（替换扩展名）
            const audioUrl = imageUrl ?
                imageUrl.replace(/\.(jpg|jpeg|png|webp)$/i, '.mp3') :
                null;

            return { imageUrl, audioUrl };
        }
    }

    // ========== 主控制器 ==========
    class ImmersionKitHelper {
        constructor() {
            this.processedItems = new WeakSet();
            this.debounceTimer = null;
        }

        async init() {
            console.log(`${CONFIG.SCRIPT_NAME} 初始化中...`);

            // 检查 AnkiConnect 连接
            const isConnected = await AnkiConnect.checkConnection();
            if (!isConnected) {
                alert('AnkiConnect 未授权。请在 Anki 弹窗中允许连接。');
                return;
            }

            console.log(`${CONFIG.SCRIPT_NAME} AnkiConnect 连接成功`);

            // 设置页面监听
            this.setupObservers();

            // 初始扫描
            setTimeout(() => this.scanAndAddButtons('初始加载'), CONFIG.INIT_DELAY);
        }

        setupObservers() {
            // 设置 MutationObserver 监听 DOM 变化
            const observer = new MutationObserver((mutations) => {
                const hasNewContent = mutations.some(m => m.addedNodes.length > 0);
                if (hasNewContent) {
                    this.debouncedScan('DOM变化');
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 设置备用轮询机制
            setInterval(() => this.scanAndAddButtons('定时轮询'), CONFIG.POLL_INTERVAL);

            console.log(`${CONFIG.SCRIPT_NAME} 监听器设置完成`);
        }

        debouncedScan(source) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(
                () => this.scanAndAddButtons(source),
                CONFIG.DEBOUNCE_DELAY
            );
        }

        scanAndAddButtons(source) {
            // 查找所有未处理的项目
            const items = document.querySelectorAll('.ui.divided.items > div.item');
            let newItemsCount = 0;

            items.forEach((item) => {
                // 使用 WeakSet 跟踪已处理的元素（避免内存泄漏）
                if (!this.processedItems.has(item)) {
                    if (this.processItem(item)) {
                        newItemsCount++;
                    }
                    this.processedItems.add(item);
                }
            });

            if (newItemsCount > 0) {
                console.log(`${CONFIG.SCRIPT_NAME} [${source}] 处理了 ${newItemsCount} 个新项目`);
            }
        }

        processItem(item) {
            const menuContainer = UIManager.findMenuContainer(item);

            if (!menuContainer) {
                return false;
            }

            // 检查是否已有按钮
            if (menuContainer.querySelector('.anki-image-button, .anki-audio-button')) {
                return false;
            }

            const { imageUrl, audioUrl } = UIManager.extractMediaUrls(item);
            let buttonsAdded = false;

            // 添加图片按钮
            if (imageUrl) {
                const button = UIManager.createButton('image', '添加图片', 'image');
                button.addEventListener('click', (e) =>
                    this.handleButtonClick(e, button, 'picture', imageUrl, CONFIG.ANKI_FIELD_FOR_IMAGE)
                );
                menuContainer.appendChild(button);
                buttonsAdded = true;
            }

            // 添加音频按钮
            if (audioUrl) {
                const button = UIManager.createButton('audio', '添加音频', 'music');
                button.addEventListener('click', (e) =>
                    this.handleButtonClick(e, button, 'audio', audioUrl, CONFIG.ANKI_FIELD_FOR_AUDIO)
                );
                menuContainer.appendChild(button);
                buttonsAdded = true;
            }

            return buttonsAdded;
        }

        async handleButtonClick(event, button, mediaType, mediaUrl, fieldName) {
            event.preventDefault();

            const originalContent = button.innerHTML;
            UIManager.updateButtonState(button, 'loading');

            try {
                // 1. 获取最新笔记ID
                const noteId = await AnkiConnect.getLatestNoteId();
                console.log(`${CONFIG.SCRIPT_NAME} 找到最新笔记 ID: ${noteId}`);

                // 2. 验证字段是否存在
                await AnkiConnect.validateNoteField(noteId, fieldName);

                // 3. 添加媒体到笔记
                const filename = await AnkiConnect.addMediaToNote(
                    noteId,
                    mediaType,
                    mediaUrl,
                    fieldName
                );

                console.log(`${CONFIG.SCRIPT_NAME} 成功添加 ${mediaType}: ${filename}`);
                UIManager.updateButtonState(button, 'success');

            } catch (error) {
                console.error(`${CONFIG.SCRIPT_NAME} 添加 ${mediaType} 失败:`, error);
                UIManager.updateButtonState(button, 'error');

                alert(`添加${mediaType === 'picture' ? '图片' : '音频'}失败:\n${error.message}`);

                // 5秒后恢复按钮原始状态
                setTimeout(() => {
                    button.innerHTML = originalContent;
                }, 5000);
            }
        }
    }

    // ========== 启动脚本 ==========
    const helper = new ImmersionKitHelper();
    helper.init();

})();