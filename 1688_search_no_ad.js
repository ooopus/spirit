(function() {
    let hostname = window.location.hostname;
    if (hostname === 's.1688.com') {
        process();
        let observer = new MutationObserver(process);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function process() {
        // 查找所有 main-img-icon 的 img 元素
        let mainImgIcons = document.querySelectorAll('img.main-img-icon');
        if (mainImgIcons && mainImgIcons.length > 0) {
            mainImgIcons.forEach(img => {
                // 获取其对应的 a.search-offer-wrapper.cardui-normal.search-offer-item.major-offer 父级元素
                let offerWrapper = img.closest('a.search-offer-wrapper.cardui-normal.search-offer-item.major-offer');
                if (offerWrapper && offerWrapper.parentNode) {
                    // 移除对应的广告父元素
                    offerWrapper.parentNode.removeChild(offerWrapper);
                }
            });
        }
    }
})();
