const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const TNA = require('tna')
const pLimit = require('p-limit')
const pQueue = require('p-queue')
const Config = require('./config.js')
const queue = new pQueue({concurrency: Config.rpc.limit})
const mingo = require('mingo')
const jq = require('bigjq')
const bcode = require('bcode')

const Filter = require('./bitdb.json')

var Db
var Info
var rpc
var filter
var processor

const init = function(db, info) {
  return new Promise(function(resolve) {
    Db = db
    Info = info

    if (Filter.filter && Filter.filter.q && Filter.filter.q.find) {
      let query = bcode.encode(Filter.filter.q.find)
      filter = new mingo.Query(query)
    } else {
      filter = null
    }

    if (Filter.filter && Filter.filter.r && Filter.filter.r.f) {
      processor = Filter.filter.r.f
    }

    rpc = new RpcClient(Config.rpc)
    resolve()
  })
}
const request = {
  block: function(block_index) {
    return new Promise(function(resolve) {
      rpc.getBlockHash(block_index, function(err, res) {
        if (err) {
          console.log('Err = ', err)
          throw new Error(err)
        } else {
          rpc.getBlock(res.result, function(err, block) {
            resolve(block)
          })
        }
      })
    })
  },
  /**
  * Return the current blockchain height
  */
  height: function() {
    return new Promise(function(resolve) {
      rpc.getBlockCount(function(err, res) {
        if (err) {
          console.log('Err = ', err)
          throw new Error(err)
        } else {
          resolve(res.result)
        }
      })
    })
  },
  tx: async function(hash) {
    let content = await TNA.fromHash(hash, Config.rpc)
    return content
  },
  mempool: function() {
    return new Promise(function(resolve) {
      rpc.getRawMemPool(async function(err, ret) {
        if (err) {
          console.log('Err', err)
        } else {
          let tasks = []
          const limit = pLimit(Config.rpc.limit)
          let txs = ret.result
          console.log('txs = ', txs.length)
          for(let i=0; i<txs.length; i++) {
            tasks.push(limit(async function() {
              let content = await request.tx(txs[i]).catch(function(e) {
                console.log('Error = ', e)
              })
              return content
            }))
          }
          let btxs = await Promise.all(tasks)
          resolve(btxs)
        }
      })
    })
  }
}
const crawl = async function(block_index) {
  let block_content = await request.block(block_index)
  let block_hash = block_content.result.hash
  let block_time = block_content.result.time

  if (block_content && block_content.result) {
    let txs = block_content.result.tx
    console.log('crawling txs = ', txs.length)
    let tasks = []
    const limit = pLimit(Config.rpc.limit)
    for(let i=0; i<txs.length; i++) {
      tasks.push(limit(async function() {
        let t = await request.tx(txs[i]).catch(function(e) {
          console.log('Error = ', e)
        })
        t.blk = {
          i: block_index,
          h: block_hash,
          t: block_time
        }
        return t
      }))
    }
    let btxs = await Promise.all(tasks)

    if (filter) {
      btxs = btxs.filter(function(row) {
        return filter.test(row)
      })

      if (processor) {
        btxs = bcode.decode(btxs)
        btxs  = await jq.run(processor, btxs)
      }
      console.log('Filtered Xputs = ', btxs.length)
    }

    console.log('Block ' + block_index + ' : ' + txs.length + 'txs | ' + btxs.length + ' filtered txs')
    return btxs
  } else {
    return []
  }
}
const outsock = zmq.socket('pub')
const listen = function() {
  let sock = zmq.socket('sub')
  sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
  sock.subscribe('hashtx')
  sock.subscribe('hashblock')
  console.log('Subscriber connected to port ' + Config.zmq.incoming.port)

  outsock.bindSync('tcp://' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)
  console.log('Started publishing to ' + Config.zmq.outgoing.host + ':' + Config.zmq.outgoing.port)

  // Listen to ZMQ
  sock.on('message', async function(topic, message) {
    if (topic.toString() === 'hashtx') {
      let hash = message.toString('hex')
      console.log('New mempool hash from ZMQ = ', hash)
      await sync('mempool', hash)
    } else if (topic.toString() === 'hashblock') {
      let hash = message.toString('hex')
      console.log('New block hash from ZMQ = ', hash)
      await sync('block')
    }
  })

  // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
  setInterval(async function() {
    await sync('block')
  }, 60000)

}

const sync = async function(type, hash) {
  if (type === 'block') {
    try {
      const lastSynchronized = await Info.checkpoint()
      const currentHeight = await request.height()
      console.log('Last Synchronized = ', lastSynchronized)
      console.log('Current Height = ', currentHeight)

      for(let index=lastSynchronized+1; index<=currentHeight; index++) {
        console.log('RPC BEGIN ' + index, new Date().toString())
        console.time('RPC END ' + index)
        let content = await crawl(index)
        console.timeEnd('RPC END ' + index)
        console.log(new Date().toString())
        console.log('DB BEGIN ' + index, new Date().toString())
        console.time('DB Insert ' + index)

        await Db.block.insert(content, index)

        await Info.updateTip(index)
        console.timeEnd('DB Insert ' + index)
        console.log('------------------------------------------')
        console.log('\n')

        // zmq broadcast
        let b = { i: index, txs: content }
        console.log('Zmq block = ', JSON.stringify(b, null, 2))
        outsock.send(['block', JSON.stringify(b)])
      }

      // clear mempool and synchronize
      if (lastSynchronized < currentHeight) {
        console.log('Clear mempool and repopulate')
        let items = await request.mempool()
        await Db.mempool.sync(items)
      }

      if (lastSynchronized === currentHeight) {
        console.log('no update')
        return null
      } else {
        console.log('[finished]')
        return currentHeight
      }
    } catch (e) {
      console.log('Error', e)
      console.log('Shutting down Bitdb...', new Date().toString())
      await Db.exit()
      process.exit()
    }
  } else if (type === 'mempool') {
    queue.add(async function() {
      let content = await request.tx(hash)
      try {
        await Db.mempool.insert(content)
        console.log('# Q inserted [size: ' + queue.size + ']',  hash)
        console.log(content)
        outsock.send(['mempool', JSON.stringify(content)])
      } catch (e) {
        // duplicates are ok because they will be ignored
        if (e.code == 11000) {
          console.log('Duplicate mempool item: ', content)
        } else {
          console.log('## ERR ', e, content)
          process.exit()
        }
      }
    })
    return hash
  }
}
const run = async function() {

  // initial block sync
  await sync('block')

  // initial mempool sync
  console.log('Clear mempool and repopulate')
  let items = await request.mempool()
  await Db.mempool.sync(items)
}
module.exports = {
  init: init, crawl: crawl, listen: listen, sync: sync, run: run
}
