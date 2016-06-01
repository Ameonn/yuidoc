module.exports = {
  basicName: function(item) {
    var index;
    var tmpItem = item;
    if ((index = tmpItem.lastIndexOf('.')) !== -1) {
      tmpItem = tmpItem.slice(index + 1, tmpItem.length);
    }
    return tmpItem;
  }
}
