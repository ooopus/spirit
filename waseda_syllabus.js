// ==UserScript==
// @name         早稻田大学シラバス(Syllabus)信息提取器
// @name:en      Waseda University Syllabus Exporter
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  从早稻田大学的教学大纲搜索结果页面，抓取完整信息并导出为Excel(.xlsx)或JSON文件。支持自动翻页。
// @description:en Extracts complete course information from Waseda University's syllabus search results and exports it as a well-formatted Excel (.xlsx) or JSON file. Supports auto-pagination.
// @author       YourName
// @match        https://www.wsl.waseda.jp/syllabus/JAA103.php*
// @match        https://www.wsl.waseda.jp/syllabus/index.php*
// @connect      wsl.waseda.jp
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

/* global XLSX */

(function() {
    'use-strict';

    // =========================================================================
    // 1. 注入UI元素 (按钮和样式)
    // =========================================================================
    function injectUI() {
        const targetContainer = document.querySelector('.c-selectall');
        if (targetContainer) {
            // 按钮 1: 导出本页 (Excel)
            const exportPageButton = document.createElement('button');
            exportPageButton.id = 'export-syllabus-page';
            exportPageButton.textContent = '导出本页 (Excel)';
            exportPageButton.addEventListener('click', () => handleExportClick(false, 'xlsx'));

            // 按钮 2: 导出全部 (Excel)
            const exportAllButton = document.createElement('button');
            exportAllButton.id = 'export-syllabus-all';
            exportAllButton.textContent = '导出所有 (Excel)';
            exportAllButton.addEventListener('click', () => handleExportClick(true, 'xlsx'));

            // 按钮 3: 导出全部 (JSON) - 新增
            const exportJsonButton = document.createElement('button');
            exportJsonButton.id = 'export-syllabus-json';
            exportJsonButton.textContent = '导出所有 (JSON)';
            exportJsonButton.addEventListener('click', () => handleExportClick(true, 'json'));

            GM_addStyle(`
                #export-syllabus-page, #export-syllabus-all, #export-syllabus-json {
                    display: inline-block; padding: 8px 16px; margin: 10px 5px 10px 10px;
                    font-size: 14px; font-weight: bold; color: #fff; background-color: #990000;
                    border: 1px solid #7a0000; border-radius: 4px; cursor: pointer; transition: background-color 0.3s;
                }
                #export-syllabus-page:hover, #export-syllabus-all:hover, #export-syllabus-json:hover { background-color: #b30000; }
                #export-syllabus-page:disabled, #export-syllabus-all:disabled, #export-syllabus-json:disabled { background-color: #cccccc; cursor: not-allowed; }
            `);

            targetContainer.appendChild(exportPageButton);
            targetContainer.appendChild(exportAllButton);
            targetContainer.appendChild(exportJsonButton);
        }
    }

    // =========================================================================
    // 2. 核心处理逻辑
    // =========================================================================
    async function handleExportClick(exportAll = false, format = 'xlsx') {
        const pageButton = document.getElementById('export-syllabus-page');
        const allButton = document.getElementById('export-syllabus-all');
        const jsonButton = document.getElementById('export-syllabus-json');

        // 禁用所有按钮
        pageButton.disabled = true;
        allButton.disabled = true;
        jsonButton.disabled = true;

        let mainButton;
        if (format === 'json') {
            mainButton = jsonButton;
        } else {
            mainButton = exportAll ? allButton : pageButton;
        }
        mainButton.textContent = '准备中...';

        let allCourseData = [];

        try {
            if (exportAll) {
                const totalPages = findTotalPages();
                if (totalPages === 0) throw new Error('无法确定总页数，请检查翻页导航是否存在。');

                for (let i = 1; i <= totalPages; i++) {
                    mainButton.textContent = `正在抓取列表页: ${i}/${totalPages}...`;
                    const pageHtml = await fetchListPageHtml(i);
                    const parser = new DOMParser();
                    const pageDoc = parser.parseFromString(pageHtml, 'text/html');
                    const pageData = await processPage(pageDoc, mainButton, `页${i}/${totalPages}`);
                    allCourseData = allCourseData.concat(pageData);
                }
            } else {
                allCourseData = await processPage(document, mainButton, '本页');
            }

            if (allCourseData.length > 0) {
                if (format === 'xlsx') {
                    mainButton.textContent = '正在生成Excel文件...';
                    downloadXLSX(allCourseData);
                } else if (format === 'json') {
                    mainButton.textContent = '正在生成JSON文件...';
                    downloadJSON(allCourseData);
                }
            } else {
                alert('没有找到可导出的数据。');
            }
        } catch(error) {
            console.error(error.message);
            alert(`操作失败: ${error.message}`);
        } finally {
            // 恢复所有按钮状态
            resetButtonsState(pageButton, allButton, jsonButton);
        }
    }

    function resetButtonsState(pageButton, allButton, jsonButton) {
        pageButton.disabled = false;
        allButton.disabled = false;
        jsonButton.disabled = false;
        pageButton.textContent = '导出本页 (Excel)';
        allButton.textContent = '导出所有 (Excel)';
        jsonButton.textContent = '导出所有 (JSON)';
    }

    async function processPage(doc, button, pageIdentifier) {
        const courseRows = doc.querySelectorAll('.ct-vh tbody tr:not(.c-vh-title)');
        if (courseRows.length === 0) return [];

        let processedCount = 0;
        const totalCount = courseRows.length;

        const promises = Array.from(courseRows).map(async (row) => {
            let courseData = {};
            try {
                const courseNameElement = row.cells[2].querySelector('a');
                if (!courseNameElement) return null;

                courseData = {
                    科目名: courseNameElement.textContent.trim(),
                    担当教員: row.cells[3].textContent.trim(),
                    配当年次: 'N/A',
                    科目区分: 'N/A',
                    授業概要: row.cells[8].textContent.trim(),
                    授業計画: 'N/A'
                };

                const onclickAttr = courseNameElement.getAttribute('onclick');
                const pKeyMatch = onclickAttr ? onclickAttr.match(/'(.*?)', '(.*?)'/) : null;

                if (pKeyMatch && pKeyMatch[2]) {
                    const pKey = pKeyMatch[2];
                    const detailUrl = `https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=${pKey}&pLng=jp`;
                    const detailHtml = await fetchDetailHtml(detailUrl);
                    const parser = new DOMParser();
                    const detailDoc = parser.parseFromString(detailHtml, 'text/html');

                    courseData.配当年次 = findCellByThText(detailDoc, '配当年次')?.textContent.trim() || courseData.配当年次;
                    courseData.科目区分 = findCellByThText(detailDoc, '科目区分')?.textContent.trim() || courseData.科目区分;
                    const fullSummaryElement = findCellByThText(detailDoc, '授業概要');
                    if (fullSummaryElement) courseData.授業概要 = getCleanText(fullSummaryElement);
                    const classPlanElement = findCellByThText(detailDoc, '授業計画');
                    if (classPlanElement) courseData.授業計画 = getCleanText(classPlanElement);
                }
                return courseData;
            } catch (error) {
                console.error(`处理课程 "${courseData.科目名 || '未知'}" 时出错:`, error);
                return courseData.科目名 ? courseData : null;
            } finally {
                processedCount++;
                button.textContent = `正在处理详情(${pageIdentifier}): ${processedCount}/${totalCount}...`;
            }
        });
        const results = await Promise.all(promises);
        return results.filter(item => item !== null);
    }

    // =========================================================================
    // 3. 辅助函数
    // =========================================================================

    /**
     * *** 新增：将数据导出为 JSON 格式的函数 ***
     * @param {Array<Object>} data - 要转换的数据
     */
    function downloadJSON(data) {
        // 将JS对象数组转换为格式化的JSON字符串 (null, 2 表示使用2个空格进行缩进)
        const jsonString = JSON.stringify(data, null, 2);

        // 创建Blob对象
        const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });

        // 创建下载链接并触发点击
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.setAttribute('href', url);
        link.setAttribute('download', `Waseda_Syllabus_${timestamp}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function downloadXLSX(data) {
        const headers = ['科目名', '担当教員', '配当年次', '科目区分', '授業概要', '授業計画'];
        const formattedData = data.map(item => ({
            科目名: item.科目名,
            担当教員: item.担当教員,
            配当年次: item.配当年次,
            科目区分: item.科目区分,
            授業概要: item.授業概要,
            授業計画: item.授業計画
        }));
        const ws = XLSX.utils.json_to_sheet(formattedData, { header: headers });
        const colWidths = headers.map((header, i) => ({
            wch: (header === '授業概要' || header === '授業計画')
                ? 50
                : Math.max(header.length, ...formattedData.map(row => (row[header] ? row[header].toString().split('\n')[0].length : 0))) + 2
        }));
        ws['!cols'] = colWidths;
        const cellStyle = { alignment: { wrapText: true, vertical: "top" } };
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell_ref = XLSX.utils.encode_cell({ c: C, r: R });
                if (ws[cell_ref]) ws[cell_ref].s = cellStyle;
            }
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Syllabus Data');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        XLSX.writeFile(wb, `Waseda_Syllabus_${timestamp}.xlsx`);
    }

    function getCleanText(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('style, script').forEach(el => el.remove());
        clone.innerHTML = clone.innerHTML.replace(/<br\s*\/?>/gi, '\n');
        let text = clone.innerText || '';
        text = text.replace(/(\s*\n\s*)+/g, '\n').trim();
        return text;
    }

    function findTotalPages() {
        const pageLinks = document.querySelectorAll('.l-btn-c a, .l-btn-c strong');
        let maxPage = 0;
        pageLinks.forEach(link => {
            const pageNum = parseInt(link.textContent, 10);
            if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
        });
        if (maxPage === 0 && document.querySelector('.l-btn-c a[onclick*="page_turning"]')) {
            const totalItemsText = document.querySelector('.c-selectall font')?.textContent.match(/全(\d+)件/);
            const itemsPerPageText = document.querySelector('input[name="p_number"]')?.value;
            if (totalItemsText && itemsPerPageText) {
                const totalItems = parseInt(totalItemsText[1], 10);
                const itemsPerPage = parseInt(itemsPerPageText, 10);
                if (totalItems > 0 && itemsPerPage > 0) return Math.ceil(totalItems / itemsPerPage);
            }
            return 1;
        }
        return maxPage || 1;
    }

    function fetchListPageHtml(pageNum) {
        const form = document.getElementById('cForm');
        const formData = new FormData(form);
        formData.set('p_page', pageNum);
        formData.set('pfrontPage', 'Gakki');
        const postData = new URLSearchParams(formData).toString();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://www.wsl.waseda.jp/syllabus/JAA103.php',
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                data: postData,
                onload: res => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error(`列表页请求失败: ${res.status}`)),
                onerror: err => reject(new Error(`网络请求错误: ${err}`))
            });
        });
    }

    function findCellByThText(doc, text) {
        const ths = Array.from(doc.querySelectorAll('th'));
        const targetTh = ths.find(th => th.textContent.trim().includes(text));
        return targetTh ? targetTh.nextElementSibling : null;
    }

    function fetchDetailHtml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: res => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error(`详情页请求失败: ${res.status}`)),
                onerror: err => reject(new Error(`网络请求错误: ${err}`))
            });
        });
    }

    // =========================================================================
    // 4. 启动脚本
    // =========================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }

})();