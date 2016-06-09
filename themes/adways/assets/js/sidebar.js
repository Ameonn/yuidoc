var toggleSideBox = function(container, button) {
    if (container.offsetHeight > 40) {
        container.style.height = "34px";
        button.className = "no-toc collapsed";
    } else {
        container.style.height = "auto";
        button.className = "no-toc";
    }
};
var toggleButtons = new Array();
var classBoxes = document.getElementsByClassName("sidebox");
var pageType = document.location.pathname.split('/');
pageType = pageType[pageType.length - 2];
if (classBoxes.length > 0) {
    for (var i = 0; i < classBoxes.length; i++) {
        toggleButtons[i] = classBoxes[i].getElementsByClassName("no-toc")[0];
        if (typeof toggleButtons[i] != "undefined") {
            if (classBoxes[i].id !== pageType) {
                toggleSideBox(classBoxes[i], toggleButtons[i]);
            }
            (function(container, button) {
              toggleButtons[i].onclick = function() {
                toggleSideBox(container, button);
            };
          })(classBoxes[i], toggleButtons[i])
        }
    }
}
