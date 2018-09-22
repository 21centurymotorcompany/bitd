const traverse = require('traverse')
const iconv = require('iconv-lite');
var encoding = function(subtree, encoding_schema) {
  let copy = subtree;
  traverse(copy).forEach(function(token) {
    if (this.isLeaf) {
      let encoding = "utf8";
      let newVal = token;

      // if the key is a special directive like '$in', traverse up the tree
      // until we find a normal key that starts with b or s
      let node = this;
      if (/^([0-9]+|\$).*/.test(node.key)) {
        while(!node.isRoot) {
          node = node.parent;
          if (/^b[0-9]+/.test(node.key)) {
            break;
          }
        }
      }

      if (encoding_schema && encoding_schema[node.key]) {
        encoding = encoding_schema[node.key];
      }

      if (/^b[0-9]+/.test(node.key)) {
        newVal = iconv.encode(token, encoding).toString("base64");
      }
      this.update(newVal)
    }
  })
  return copy;
}
module.exports = encoding;
