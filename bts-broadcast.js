'use strict';

const btsCache = require('./bts-cache');
const promiseRetry = require('promise-retry');

const bitsharesjs = require('bitsharesjs');
const bsws = require('bitsharesjs-ws');
const Apis = bsws.Apis;

const ops = bitsharesjs.ops;

function getPossibleFeeAsset(acc) {
    return '1.3.0';
}


function checkTransaction(tr, br_result) {
    // tr: 发送的transaction
    // br_result: API返回的异步通知结果，超时情况下为null
    // todo: 分叉检查
    // todo: 超时但成功，语义检查
    if (br_result) {
        return Promise.resolve(br_result);
    }
    else {
        return Promise.reject('timeout');
    }
}

function broadcastTransaction(tr) {
    return new Promise((resolve, reject) => {
        var to_exec = false;
        var to = setTimeout(() => {
            to_exec = true;
            console.log("t ref_block_num", tr.ref_block_num);
            return resolve({
                tr: tr,
                result: null,
            });
        }, 4 * 60 * 1000);
        tr.broadcast().then((r) => {
            console.log("r ref_block_num", tr.ref_block_num);
            if (!to_exec) {
                clearTimeout(to);
                to = null;
                resolve({
                    tr: tr,
                    result: r,
                });
            }
        }).catch((e) => {
            console.log("e ref_block_num", tr.ref_block_num);
            if (!to_exec) {
                clearTimeout(to);
                to = null;
                reject(e);
            }
        })
    }).then((r) => {
        return checkTransaction(r.tr, r.result);
    });
}



function getIntAmount(amount_float, precision) {
    let amount = amount_float * Math.pow(10, precision);
    return Number(amount.toFixed(0))
}

function doPlaceOrder(account_name, active_key_wif, base_asset_symbol, quote_asset_symbol, is_buy, price_float, quote_amount_float) {

    var active_key = bitsharesjs.PrivateKey.fromWif(active_key_wif);
    return Promise.all([
        btsCache.get_full_account(account_name),
        btsCache.get_asset(base_asset_symbol),
        btsCache.get_asset(quote_asset_symbol)
    ]).then(results => {
        var account = results[0];
        var base_asset = results[1];
        var quote_asset = results[2];

        let tr = new bitsharesjs.TransactionBuilder();

        let base_amount = {
            asset_id: base_asset.id,
            amount: getIntAmount(quote_amount_float * price_float, base_asset.precision)
        }

        let quote_amount = {
            asset_id: quote_asset.id,
            amount: getIntAmount(quote_amount_float, quote_asset.precision)
        }
        let sell_amount, get_amount;
        if (is_buy) {
            sell_amount = base_amount;
            get_amount = quote_amount;
        }
        else {
            sell_amount = quote_amount;
            get_amount = base_amount;
        }

        let now = new Date().getTime();
        let one_year = 365 * 24 * 60 * 60 * 1000;
        let one_year_later = now + one_year;
        let expiration = new Date(one_year_later).toISOString().slice(0, -5)

        var op = {
            fee: {
                amount: 0,
                asset_id: getPossibleFeeAsset(account)
            },
            seller: account.account.id,
            amount_to_sell: sell_amount,
            min_to_receive: get_amount,
            expiration: expiration,
            fill_or_kill: false,
        }



        tr.add_type_operation("limit_order_create", op);

        return tr.set_required_fees().then(() => {
            console.log('set_required_fees ok, broadcasting');
            tr.add_signer(active_key, active_key.toPublicKey().toPublicKeyString());
            return tr;
        })
    }).then(broadcastTransaction);
}


function doPlaceOrders(account_name, active_key_wif, order_reqs) {

    var active_key = bitsharesjs.PrivateKey.fromWif(active_key_wif);
    var asset_symbols = [];
    order_reqs.forEach(req => {
        if (asset_symbols.indexOf(req.base_asset_symbol) < 0) {
            asset_symbols.push(req.base_asset_symbol);
        }
        if (asset_symbols.indexOf(req.quote_asset_symbol) < 0) {
            asset_symbols.push(req.quote_asset_symbol);
        }
    })
    var assets_map = {};
    return Promise.all([
        btsCache.get_full_account(account_name),
        Promise.all( asset_symbols.map(btsCache.get_asset) )
    ]).then(results => {
        var account = results[0];
        for (var i = 0; i < asset_symbols.length; i++) {
            assets_map[asset_symbols[i]] = results[1][i];
        }

        let tr = new bitsharesjs.TransactionBuilder();

        order_reqs.forEach(req => {
            let base_asset = assets_map[req.base_asset_symbol];
            let quote_asset = assets_map[req.quote_asset_symbol];
            let base_amount = {
                asset_id: base_asset.id,
                amount: getIntAmount(req.quote_amount_float * req.price_float, base_asset.precision)
            }

            let quote_amount = {
                asset_id: quote_asset.id,
                amount: getIntAmount(req.quote_amount_float, quote_asset.precision)
            }
            let sell_amount, get_amount;
            if (req.is_buy) {
                sell_amount = base_amount;
                get_amount = quote_amount;
            }
            else {
                sell_amount = quote_amount;
                get_amount = base_amount;
            }

            let now = new Date().getTime();
            let one_year = 365 * 24 * 60 * 60 * 1000;
            let one_year_later = now + one_year;
            let expiration = new Date(one_year_later).toISOString().slice(0, -5)

            var op = {
                fee: {
                    amount: 0,
                    asset_id: getPossibleFeeAsset(account)
                },
                seller: account.account.id,
                amount_to_sell: sell_amount,
                min_to_receive: get_amount,
                expiration: expiration,
                fill_or_kill: false,
            }



            tr.add_type_operation("limit_order_create", op);
        });

        return tr.set_required_fees().then(() => {
            console.log('set_required_fees ok, broadcasting');
            tr.add_signer(active_key, active_key.toPublicKey().toPublicKeyString());
            return tr;
        })
    }).then(broadcastTransaction);
}

function doCancelOrder(account_name, active_key_wif, order_id) {

    var active_key = bitsharesjs.PrivateKey.fromWif(active_key_wif);
    return Promise.all([
        btsCache.get_full_account(account_name),
    ]).then(results => {
        var account = results[0];

        let tr = new bitsharesjs.TransactionBuilder();

        var op = {
            fee: {
                amount: 0,
                asset_id: getPossibleFeeAsset(account)
            },
            fee_paying_account: account.account.id,
            order: order_id
        }

        tr.add_type_operation("limit_order_cancel", op);

        return tr.set_required_fees().then(() => {
            console.log('set_required_fees ok, broadcasting');
            tr.add_signer(active_key, active_key.toPublicKey().toPublicKeyString());
            return tr;
        })
    }).then(broadcastTransaction);
}


module.exports = {
    doPlaceOrder: doPlaceOrder,
    doPlaceOrders: doPlaceOrders,
    doCancelOrder: doCancelOrder,
}
