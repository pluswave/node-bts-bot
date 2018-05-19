'use strict';

const cache = require('./bts-cache');
const bitsharesjs = require('bitsharesjs');
const bsws = require('bitsharesjs-ws');
const Apis = bsws.Apis;

function getMarketPrice(base_asset_symbol, quote_asset_symbol) {
    return getOpenOrders(base_asset_symbol, quote_asset_symbol)
        .then(o => {
            let askPrice, bidPrice, i;
            for (i = 0; i < o.askOrders.length; i++) {
                if (o.askOrders[i].parsed.base_amount > 0.1 && o.askOrders[i].parsed.quote_amount > 0.1) {
                    askPrice = o.askOrders[i].parsed.price;
                    break;
                }
            }
            for (i = 0; i < o.bidOrders.length; i++) {
                if (o.bidOrders[i].parsed.base_amount > 0.1 && o.bidOrders[i].parsed.quote_amount > 0.1) {
                    bidPrice = o.bidOrders[i].parsed.price;
                    break;
                }
            }
            if (askPrice && bidPrice) {
                if (askPrice >= bidPrice)
                    return (askPrice + bidPrice) / 2;
                else {
                    // return 'Unknow ... ';
                    // 有人砸盘或者大量吃进，机器人可 。。。 
                    return -1;
                }
            }
            else
                return -1;
        })

}

function getOpenOrders(base_asset_symbol, quote_asset_symbol) {
    var base_asset, quote_asset;
    return cache.get_assets([base_asset_symbol, quote_asset_symbol])
        .then((assets) => {
            base_asset = assets[0];
            quote_asset = assets[1];
            return Apis.instance().db_api().exec('get_limit_orders', [base_asset.id, quote_asset.id, 25])
        })
        .then((orders) => {
            var bidOrders = orders.filter(o => {
                return o.sell_price.base.asset_id == base_asset.id;
            })
            var askOrders = orders.filter(o => {
                return o.sell_price.base.asset_id == quote_asset.id;
            })
            orders.forEach((o) => {
                o.parsed = {};
            })
            bidOrders.forEach(o => {
                o.parsed.quote_amount = o.sell_price.quote.amount / Math.pow(10, quote_asset.precision);
                o.parsed.base_amount = o.sell_price.base.amount / Math.pow(10, base_asset.precision);
                o.parsed.current_base_amount = o.for_sale / Math.pow(10, base_asset.precision);
                o.parsed.price = o.parsed.base_amount / o.parsed.quote_amount;
            })
            askOrders.forEach(o => {
                o.parsed.quote_amount = o.sell_price.base.amount / Math.pow(10, quote_asset.precision);
                o.parsed.base_amount = o.sell_price.quote.amount / Math.pow(10, base_asset.precision);
                o.parsed.current_quote_amount = o.for_sale / Math.pow(10, quote_asset.precision);
                o.parsed.price = o.parsed.base_amount / o.parsed.quote_amount;
            })
            return {
                bidOrders: bidOrders,
                askOrders: askOrders
            }
        })
}

function getFilledOrders(base_asset_symbol, quote_asset_symbol) {
    var base_asset, quote_asset;
    return cache.get_assets([base_asset_symbol, quote_asset_symbol])
        .then((assets) => {
            base_asset = assets[0];
            quote_asset = assets[1];
            return Apis.instance().history_api().exec('get_fill_order_history', [base_asset.id, quote_asset.id, 20])
        }).then((orders) => {
            orders.forEach((o) => {
                o.parsed = {}
                // o.parsed.quote_amout = 
                if (o.op.pays.asset_id == base_asset.id) { // 买单成交
                    o.parsed.filled_base_amount = o.op.pays.amount / Math.pow(10, base_asset.precision);
                    o.parsed.filled_quote_amount = o.op.receives.amount / Math.pow(10, quote_asset.precision);
                    o.parsed.direction = 'ask';
                }
                else { // 卖单成交
                    o.parsed.filled_base_amount = o.op.receives.amount / Math.pow(10, base_asset.precision);
                    o.parsed.filled_quote_amount = o.op.pays.amount / Math.pow(10, quote_asset.precision);
                    o.parsed.direction = 'bid';
                }
                if (o.op.fill_price.base.asset_id == base_asset.id) {
                    o.parsed.order_base_amount = o.op.fill_price.base.amount / Math.pow(10, base_asset.precision);
                    o.parsed.order_quote_amount = o.op.fill_price.quote.amount / Math.pow(10, quote_asset.precision);
                }
                else {
                    o.parsed.order_base_amount = o.op.fill_price.quote.amount / Math.pow(10, base_asset.precision);
                    o.parsed.order_quote_amount = o.op.fill_price.base.amount / Math.pow(10, quote_asset.precision);
                }
                o.parsed.is_maker = o.op.is_maker;
                o.parsed.fill_price = o.parsed.filled_base_amount / o.parsed.filled_quote_amount;
                o.parsed.order_price = o.parsed.order_base_amount / o.parsed.order_quote_amount;
            });
            return orders;
        })
}

function getLatestFillPrice(base_asset_symbol, quote_asset_symbol) {
    return getFilledOrders(base_asset_symbol, quote_asset_symbol)
        .then((orders) => {
            var price = -1;
            for (var i = 0; i < orders.length; i++) {
                if (orders[i].parsed.filled_base_amount > 0.1 && orders[i].parsed.filled_quote_amount > 0.1) {
                    price = orders[i].parsed.order_price;
                    break;
                }
            }
            return price;
        })
}



module.exports = {
    getMarketPrice: getMarketPrice,
    getLatestFillPrice: getLatestFillPrice,
    getOpenOrders: getOpenOrders,
    getFilledOrders: getFilledOrders,
}