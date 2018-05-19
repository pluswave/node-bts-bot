'use strict';

const bitsharesjs = require('bitsharesjs');
const bsws = require('bitsharesjs-ws');
const Apis = bsws.Apis;
const promiseRetry = require('promise-retry');
const debug = console.log;

const btsApiNodes = require('./apinodes');

function getApiNode() {
    const maxIndex = btsApiNodes.length;
    var i = Math.floor(Math.random() * maxIndex);
    return btsApiNodes[i].url;
}

var conStatus = 'closed';
Apis.setRpcConnectionStatusCallback(function (status) {
    conStatus = status;
    if (status == 'open') {
        connectChain().then(set_subscribe_callback);
    }
    else if (status == 'closed' || status == 'error') {
        console.log('cache: reconnecting to api instance');
        connectChain();
    }
})


var lastPromise = null;
function connectChain() {
    function _rawConnectChain() {
        var connect = conStatus == 'closed' || conStatus == 'error';
        if (connect) {
            conStatus = 'connecting';
            var nodeAddress = getApiNode();
            console.log('api', nodeAddress);
            lastPromise = Apis.instance(nodeAddress, true).init_promise.catch(connectChain);
        }
        return lastPromise;
    }
    return _rawConnectChain();
}

// 关注的帐号缓存
var account_cache = {

}

// 帐号相关的统计 缓存
var statistic_cache = {

}

//
var asset_cache = {

}
var all_caches = {
    global_dynamic: {}
}
function isDiff2statistic(s0, s1) {
    for (var key in s0) {
        if (s0[key] !== s1[key]) {
            return true;
        }
    }
    return false;
}

function copyStatistic(s0, s1) {
    for (var key in s1) {
        s0[key] = s1[key];
    }
}

function objectChange(obj) {
    // console.log(obj.id);
    if (statistic_cache[obj.id] && isDiff2statistic(statistic_cache[obj.id], obj)) {
        console.log('cache hit', statistic_cache[obj.id], obj);
        _get_account_from_chain(statistic_cache[obj.id].owner, true)
            .then((accountObj) => {
                copyStatistic(statistic_cache[obj.id], obj);
                full_account_change_callbacks.forEach(cb => {
                    cb(accountObj.account.name);
                })
            })
            .catch(console.error);
    }
    else if (obj.id == '2.1.0') {
        all_caches.global_dynamic = obj;
    }
    else if (obj.id.startsWith('1.3.')) { // assets
        asset_cache[obj.id] = obj;
        asset_cache[obj.symbol] = obj;
    }
    else if (obj.id.startsWith('2.4.')) { // bitassets
        asset_cache[obj.id] = obj;
        var asset_id = obj.current_feed.core_exchange_rate.base.asset_id;
        if (asset_cache[asset_id]) {
            asset_cache[asset_id].core_exchange_rate = obj.current_feed.core_exchange_rate;
        }
    }
}

function _get_account_from_chain(account, cache) {

    function fetch_account() {
        return connectChain().then(() => {
            return Apis.instance().db_api().exec('get_full_accounts', [[account], false])
        }).then((accs) => {
            if (accs[0] && accs[0][1]) {
                return accs[0][1];
            }
            else {
                throw new Error('no such account');
            }
        });
    }

    return promiseRetry(function (retry, number) {
        console.log('attempt number', number);

        return fetch_account()
            .catch(function (err) {
                console.error(err);
                if (err.message != 'no such account') {
                    retry(err);
                }
                else {
                    throw err;
                }
            });
    }, { retries: 8 }).then(function (account_object) {
        if (cache) {
            account_cache[account_object.account.id] = account_object;
            account_cache[account_object.account.name] = account_object;
            if (!statistic_cache[account_object.statistics.id]) {
                statistic_cache[account_object.statistics.id] = account_object.statistics;
            }
            Apis.instance().db_api().exec('get_objects', [[account_object.statistics.id]]);
        }
        else {
            setTimeout(() => {
                account_fetching[account] = null;
                delete account_fetching[account];
            }, 10 * 1000);
        }
        return account_object;
    });
}

function _get_objects_from_chain(obj_ids) {

    function fetch_objs() {
        return connectChain().then(() => {
            return Apis.instance().db_api().exec('get_objects', [obj_ids])
        }).then((accs) => {
            return accs;
        });
    }

    return promiseRetry(function (retry, number) {
        debug('attempt number', number);

        return fetch_objs()
            .catch(function (err) {
                debug(err);
                retry(err);
            });
    }).then(function (objs) {
        return objs;
    });
}

function _get_assets_from_chain(asset_symbols) {

    function fetch_asset() {
        return connectChain().then(() => {
            return Apis.instance().db_api().exec('lookup_asset_symbols', [asset_symbols])
        }).then((accs) => {
            return accs;
        });
    }

    return promiseRetry(function (retry, number) {

        return fetch_asset()
            .catch(function (err) {
                console.error(err);
                retry(err);
            });
    }).then(function (assets) {
        var id_array = assets.map(asset => asset.id);
        assets.forEach(asset => {
            if (asset.bitasset_data_id) {
                id_array.push(asset.bitasset_data_id);
            }
        })
        Apis.instance().db_api().exec('get_objects', [id_array])
            .then(objects => {
                objects.forEach(objectChange);
            });
        return assets;
    });
}

function _get_account_history_from_chain(account_id) {

    function get_history() {
        return connectChain().then(() => {
            return Apis.instance().history_api().exec('get_account_history',
                [account_id, '1.11.0', 100, '1.11.9999999999999'])
        }).then((transes) => {
            console.log(transes);
            return transes;
        });
    }

    return promiseRetry(function (retry, number) {

        return get_history()
            .catch(function (err) {
                console.error(err);
                retry(err);
            });
    }).then(function (transes) {
        return transes;
    });
}


function chainUpdate(update_objects) {
    update_objects.forEach((cs) => {
        cs.forEach(objectChange);
    });
}


function set_subscribe_callback() {
    Apis.instance().db_api().exec("set_subscribe_callback", [chainUpdate, false])
        .then(() => {
            var s = new Set();
            var key;
            for (key in statistic_cache) {
                var statistic_object = statistic_cache[key];
                s.add(statistic_object.id);
            }
            s.add('2.1.0');
            for (key in asset_cache) {
                s.add(asset_cache[key].id);
            }
            Apis.instance().db_api().exec('get_objects', [Array.from(s)])
                .then(results => {
                    results.forEach(objectChange);
                })

        })
        .catch(error => {
            console.error(error);
        });
}

var account_fetching = {

}

function get_full_account(account, cache = false) {
    // console.log(account);
    if (account_cache[account]) {
        return Promise.resolve(account_cache[account]);
    }
    if (!account_fetching[account]) {
        account_fetching[account] = _get_account_from_chain(account, cache);
    }
    return account_fetching[account];
}

var assets_fetching = {
    // [ promise, index]
}

function get_asset(asset_symbol_or_id) {
    if (asset_cache[asset_symbol_or_id]) {
        return Promise.resolve(asset_cache[asset_symbol_or_id]);
    }

    else if (!assets_fetching[asset_symbol_or_id]) {
        if (asset_symbol_or_id.startsWith('1.3.')) {
            assets_fetching[asset_symbol_or_id] = {};
            assets_fetching[asset_symbol_or_id].promise = _get_objects_from_chain([asset_symbol_or_id]);
            assets_fetching[asset_symbol_or_id].index = 0;
        }
        else {
            assets_fetching[asset_symbol_or_id] = {};
            assets_fetching[asset_symbol_or_id].promise = _get_assets_from_chain([asset_symbol_or_id]);
            assets_fetching[asset_symbol_or_id].index = 0;
        }
    }
    return assets_fetching[asset_symbol_or_id].promise.then(
        s => s[assets_fetching[asset_symbol_or_id].index]
    );
}

function get_assets(asset_symbol_or_id_array) {
    var in_cache = asset_symbol_or_id_array.filter(a => asset_cache[a] || assets_fetching[a]);
    var not_in_cache = asset_symbol_or_id_array.filter(a => in_cache.indexOf(a) < 0);

    if (not_in_cache.length > 0) {
        var apromise = _get_assets_from_chain(not_in_cache);
        for (var i in not_in_cache) {
            var a = not_in_cache[i]
            assets_fetching[a] = {}
            assets_fetching[a].promise = apromise;
            assets_fetching[a].index = i;
        }
    }
    return Promise.all(asset_symbol_or_id_array.map(get_asset));
}


function get_bitasset_feed(asset_symbol_or_id) {
    let assetPromise = get_asset(asset_symbol_or_id);
    return assetPromise.then((asset) => {
        if (asset_cache[asset.bitasset_data_id]) {
            return asset_cache[asset.bitasset_data_id];
        }
        else {
            return _get_objects_from_chain([asset.bitasset_data_id])
                .then(s => s[0]);
        }
    })

}

var full_account_change_callbacks = [];
function add_full_account_change_callback(cb) {
    if (full_account_change_callbacks.indexOf(cb) < 0)
        full_account_change_callbacks.push(cb);
}

function get_global_dynamic() {

    function fetch_global() {
        return connectChain().then(() => {
            return Apis.instance().db_api().exec('get_objects', [['2.1.0']])
        }).then((objs) => {
            return objs[0];
        });
    }
    if (all_caches.global_dynamic.head_block_number) {
        return Promise.resolve(all_caches.global_dynamic);
    }
    return fetch_global();
}




module.exports = {
    connectChain: connectChain,
    get_full_account: get_full_account,
    add_full_account_change_callback: add_full_account_change_callback,
    get_global_dynamic: get_global_dynamic,
    get_asset: get_asset,
    get_assets: get_assets,
    get_bitasset_feed: get_bitasset_feed,
    /* for test */
    get_account_history_from_chain: _get_account_history_from_chain,
}
