(function() {
    let hostname = window.location.hostname;
    if (hostname == 's.1688.com') {
        process();
        // 使用 MutationObserver 替代 DOMSubtreeModified 以提高性能
        let observer = new MutationObserver(process);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function process() {
        // 移除 main-img-icon 广告
        let mainImgIcons = document.getElementsByClassName('main-img-icon');
        removeElements(mainImgIcons);
        
        // 移除 ad-item 广告
        let adItems = document.getElementsByClassName('ad-item');
        removeElements(adItems);
    }

    function removeElements(elements) {
        // 遍历元素并移除其父级节点
        if (elements && elements.length > 0) {
            for (let i = elements.length - 1; i >= 0; i--) {
                let parent = elements[i].parentNode;
                if (parent && parent.parentNode) {
                    parent.parentNode.removeChild(parent);
                }
            }
        }
    }
})();
