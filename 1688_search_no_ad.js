// ==UserScript==
// @name         1688屏蔽搜索广告
// @version      0.1
// @description  删除1688广告商品，在原位留下空白
// @match        https://s.1688.com/selloffer/*
// @license      GPLv3 
// @namespace https://greasyfork.org/users/1367202
// ==/UserScript==

(function () {
    const hostname = window.location.hostname;
    if (hostname === 's.1688.com') {
        process();
        const observer = new MutationObserver(process);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function process() {
        // 查找所有 main-img-icon 的 img 元素
        const mainImgIcons = document.querySelectorAll('img.main-img-icon');
        if (mainImgIcons.length > 0) {
            const offersToRemove = [];
            mainImgIcons.forEach(img => {
                // 获取其对应的 a.search-offer-wrapper.cardui-normal.search-offer-item.major-offer 父级元素
                const offerWrapper = img.closest('a.search-offer-wrapper.cardui-normal.search-offer-item.major-offer');
                if (offerWrapper && offerWrapper.parentNode) {
                    // 收集需要移除的广告父元素
                    offersToRemove.push(offerWrapper);
                }
            });
            // 一次性移除所有收集到的广告父元素
            offersToRemove.forEach(offer => offer.remove());
        }
    }
})();
