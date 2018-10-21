const level = require('level')
const kv = level('./.state')
const Filter = require('./bitdb.json')
/**
* Return the last synchronized checkpoint
*/
const checkpoint = function() {
  return new Promise(async function(resolve, reject) {
    kv.get('tip', function(err, value) {
      if (err) {
        if (err.notFound) {
          console.log('Checkpoint not found, starting from GENESIS')
          resolve(Filter.from)
        } else {
          console.log('err', err)
          reject(err)
        }
      } else {
        let cp = parseInt(value)
        console.log('Checkpoint found,', cp)
        resolve(cp)
      }
    })
  })
}
const updateTip = function(index) {
  return new Promise(function(resolve, reject) {
    kv.put('tip', index, function(err) {
      if (err) {
        console.log(err)
        reject()
      } else {
        console.log('Tip updated to', index)
        resolve()
      }
    })
  })
}
const deleteTip = function() {
  return new Promise(function(resolve, reject) {
    kv.del('tip', function(err) {
      if (err) {
        console.log(err)
        reject()
      } else {
        console.log('Tip deleted')
        resolve()
      }
    })
  })
}
module.exports = {
  checkpoint: checkpoint,
  updateTip: updateTip,
  deleteTip: deleteTip
}
