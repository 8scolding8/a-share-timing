/* 守护脚本（ES5）：页面脚本出错或图表库没加载时，在顶部写明原因，而不是一片空白。 */
(function () {
  'use strict';
  function show(msg) {
    var b = document.getElementById('banner');
    if (!b) { return; }
    b.textContent = msg;
    b.className = 'banner err';
  }
  window.__labShowError = show;
  window.addEventListener('error', function (e) {
    show('页面脚本出错：' + (e && e.message ? e.message : '未知错误') + '。请用最新版 Chrome 或 Edge 打开；仍有问题请把这条提示截图发给维护者。');
  });
  window.addEventListener('load', function () {
    if (typeof window.echarts === 'undefined') {
      show('图表库没有加载成功，图表无法显示（表格仍可使用）。请刷新页面；仍有问题请联系维护者。');
    }
  });
})();
