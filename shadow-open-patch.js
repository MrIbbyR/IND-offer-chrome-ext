// Force all shadow roots to mode:"open" so content scripts can extract text.
// Must run at document_start in MAIN world, before page JS creates web components.
(function () {
  var orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    if (init && init.mode === "closed") {
      init = Object.assign({}, init, { mode: "open" });
    }
    return orig.call(this, init);
  };
})();
