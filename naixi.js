// ==UserScript==
// @name        奶昔论坛自动访问空间刷金币
// @namespace   Violentmonkey Scripts
// @match       https://forum.naixi.net/*
// @grant       none
// @version     1.0
// @author      -
// @description 2025/1/30 09:19:35
// ==/UserScript==
(function() {
  const currentUserId = 10; // 你的UID

  function getToday() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  function isFirstVisitToday() {
    const lastVisitDate = localStorage.getItem('lastVisitDate');
    const today = getToday();
    if (lastVisitDate !== today) {
      localStorage.setItem('lastVisitDate', today);
      return true;
    }
    return false;
  }

  function visitUserSpace(userId) {
      const userUrl = `https://forum.naixi.net/home.php?mod=space&uid=${userId}`;
    console.log(`正在访问用户 ${userId} 的空间: ${userUrl}`);
    window.location.href = userUrl;
  }

  function visitTopUsers() {
    for (let i = 1; i <= 10; i++) {
      const targetUserId = currentUserId + i;
       setTimeout(() => {
      visitUserSpace(targetUserId);
    }, i * 1000); // 延迟 1 秒跳转到下一个用户
    }
  }

  if (isFirstVisitToday()) {
    console.log("今天是首次访问，开始访问前十名用户的空间");
    visitTopUsers();
  } else {
    console.log("今天已经访问过前十名用户的空间了");
  }

})();
