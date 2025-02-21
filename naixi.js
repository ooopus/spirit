// ==UserScript==
// @name         奶昔论坛自动访问空间刷金币和签到
// @namespace    Violentmonkey Scripts
// @match        https://forum.naixi.net/*
// @grant        none
// @version      1.2.3
// @author       -
// @description  2025/1/30 09:19:35 - 自动签到和访问空间刷金币（优化状态窗口显示）
// ==/UserScript==

(function() {
  'use strict';

  /******************************
   * 配置项及工具函数
   ******************************/
  const CONFIG = {
    startUserId: 1,                   // 起始用户ID
    numberOfUsersToVisit: 10,         // 每天要访问的用户空间数量
    signInButtonSelector: '#JD_sign', // 签到按钮的 CSS 选择器
    signInPageUrl: 'https://forum.naixi.net/plugin.php?id=k_misign:sign',
    delay: {                          // 延时设置（毫秒）
      beforeVisit: { min: 1000, max: 1500 },
      betweenVisits: { min: 2000, max: 3000 }
    }
  };

  /**
   * 获取今日日期字符串，格式：YYYY-M-D
   * @returns {string}
   */
  function getToday() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  /**
   * 获取签到和访问状态
   * @returns {Object} { needSign: Boolean, visitedUsers: Array }
   */
  function checkDailyStatus() {
    const today = getToday();
    const lastSignDate = localStorage.getItem('lastSignDate');
    const visitedUsers = JSON.parse(localStorage.getItem('visitedUsers') || '[]');
    const lastVisitDate = localStorage.getItem('lastVisitDate');

    // 如果日期发生变化，则重置访问记录
    if (lastVisitDate !== today) {
      localStorage.setItem('lastVisitDate', today);
      localStorage.removeItem('visitedUsers');
      return {
        needSign: lastSignDate !== today,
        visitedUsers: []
      };
    }

    return {
      needSign: lastSignDate !== today,
      visitedUsers
    };
  }

  /**
   * 记录已访问的用户ID到本地存储中
   * @param {number} userId
   */
  function recordUserVisit(userId) {
    const visitedUsers = JSON.parse(localStorage.getItem('visitedUsers') || '[]');
    if (!visitedUsers.includes(userId)) {
      visitedUsers.push(userId);
      localStorage.setItem('visitedUsers', JSON.stringify(visitedUsers));
    }
  }

  /**
   * 返回介于min和max之间的随机延时（毫秒）
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function randomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  /******************************
   * 状态窗口相关函数
   ******************************/
  /**
   * 创建左上角的状态窗口
   * @returns {HTMLElement} 状态窗口的 DOM 节点
   */
  function createStatusWindow() {
    const statusDiv = document.createElement("div");
    statusDiv.id = "status-window";
    statusDiv.style.position = "fixed";
    statusDiv.style.top = "10px";
    statusDiv.style.left = "10px";
    statusDiv.style.padding = "10px";
    statusDiv.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    statusDiv.style.color = "#fff";
    statusDiv.style.fontSize = "12px";
    statusDiv.style.zIndex = "9999";
    statusDiv.style.borderRadius = "5px";
    statusDiv.style.maxWidth = "300px";
    statusDiv.style.lineHeight = "1.5";
    statusDiv.innerHTML = "脚本开始执行...";
    document.body.appendChild(statusDiv);
    return statusDiv;
  }

  /**
   * 更新状态窗口的显示内容
   * @param {string} message - 要显示的消息
   */
  function updateStatus(message) {
    const statusDiv = document.getElementById("status-window");
    if (statusDiv) {
      statusDiv.innerHTML = message;
    }
    console.log(message);
  }

  /**
   * 移除状态窗口
   */
  function removeStatusWindow() {
    const statusDiv = document.getElementById("status-window");
    if (statusDiv) {
      statusDiv.parentNode.removeChild(statusDiv);
    }
  }

  /******************************
   * 主要业务逻辑
   ******************************/

  /**
   * 访问指定用户的空间页面
   * @param {number} userId
   */
  function visitUserSpace(userId) {
    const userUrl = `https://forum.naixi.net/home.php?mod=space&uid=${userId}`;
    updateStatus(`正在访问用户 ${userId} 的空间：<br>${userUrl}`);
    recordUserVisit(userId);
    window.location.href = userUrl;
  }

  /**
   * 递归访问用户空间
   * @param {number} currentIndex 当前访问索引（从0开始）
   */
  function visitUsers(currentIndex = 0) {
    const { visitedUsers } = checkDailyStatus();

    if (visitedUsers.length >= CONFIG.numberOfUsersToVisit) {
      updateStatus("今天已经访问完所有计划的用户空间，任务完成！");
      // 任务结束后延时移除状态窗口
      setTimeout(removeStatusWindow, 2000);
      return;
    }

    // 计算下一个用户ID，确保不会重复访问
    let nextUserId = CONFIG.startUserId + currentIndex;
    while (visitedUsers.includes(nextUserId) && nextUserId < CONFIG.startUserId + CONFIG.numberOfUsersToVisit) {
      nextUserId++;
    }

    if (nextUserId < CONFIG.startUserId + CONFIG.numberOfUsersToVisit) {
      setTimeout(() => {
        visitUserSpace(nextUserId);
        setTimeout(() => {
          visitUsers(nextUserId - CONFIG.startUserId + 1);
        }, randomDelay(CONFIG.delay.betweenVisits.min, CONFIG.delay.betweenVisits.max));
      }, randomDelay(CONFIG.delay.beforeVisit.min, CONFIG.delay.beforeVisit.max));
    }
  }

  /**
   * 自动签到流程
   */
  function autoSignIn() {
    updateStatus("尝试自动签到...");
    if (window.location.href !== CONFIG.signInPageUrl) {
      updateStatus("跳转到签到页面...");
      window.location.href = CONFIG.signInPageUrl;
      return;
    }

    const signInButton = document.querySelector(CONFIG.signInButtonSelector);
    if (signInButton) {
      updateStatus("找到签到按钮，正在点击...");
      signInButton.click();
      localStorage.setItem('lastSignDate', getToday());
      updateStatus("签到完成，已记录签到日期。");
      setTimeout(removeStatusWindow, 2000);
    } else {
      updateStatus("未找到签到按钮，可能已签到或页面结构已更改。");
      setTimeout(removeStatusWindow, 2000);
    }
  }

  /******************************
   * 主逻辑判断
   ******************************/
  const status = checkDailyStatus();

  // 判断当天任务是否已完成
  const taskCompleted = !status.needSign && status.visitedUsers.length >= CONFIG.numberOfUsersToVisit;

  // 若任务已完成，则不创建状态窗口也不执行任务逻辑
  if (taskCompleted) {
    console.log("今天的签到与访问任务均已完成，不再显示状态窗口。");
    return;
  }

  // 任务未完成，创建状态窗口
  createStatusWindow();

  if (status.needSign) {
    updateStatus("今天尚未签到，开始签到流程...");
    autoSignIn();
  }

  // 如果当前页面不是签到页面，则启动访问用户空间任务
  if (window.location.href !== CONFIG.signInPageUrl) {
    const remainingVisits = CONFIG.numberOfUsersToVisit - status.visitedUsers.length;
    if (remainingVisits > 0) {
      updateStatus(`今天还需访问 ${remainingVisits} 个用户空间...`);
      visitUsers(status.visitedUsers.length);
    } else {
      updateStatus("今天的访问任务已全部完成！");
      setTimeout(removeStatusWindow, 2000);
    }
  }
})();
