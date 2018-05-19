'use strict';

const cache = require('./bts-cache');
const marketData = require('./bts-market-data');

// 获取 帐号的 value(quote_asset) / ( value(base_asset) + value(quote_asset) )
function get_account_asset_ratio(account, base_asset_symbol, quote_asset_symbol, price) {
    var pa = [
        cache.get_full_account(account, true),
        cache.get_assets([base_asset_symbol, quote_asset_symbol])
    ];
    if (!price) {
        pa.push(marketData.getLatestFillPrice(base_asset_symbol, quote_asset_symbol));
        pa.push(marketData.getMarketPrice(base_asset_symbol, quote_asset_symbol));
    }
    return Promise.all(pa).then(results => {
        var balances = results[0].balances;
        var base_asset = results[1][0];
        var quote_asset = results[1][1];
        var filledPrice, marketPrice;
        if (price) {
            marketPrice = price;
        }
        else {
            filledPrice = results[2];
            marketPrice = results[3];
            if (marketPrice < 0) {
                marketPrice = filledPrice;
            }
        }
        var base_balance, quote_balance;

        balances.forEach((balance) => {
            if (balance.asset_type == base_asset.id) {
                base_balance = balance.balance / Math.pow(10, base_asset.precision);
            }
            else if (balance.asset_type == quote_asset.id) {
                quote_balance = balance.balance / Math.pow(10, quote_asset.precision);
            }
        })
        results[0].limit_orders.forEach(o => {
            if (o.sell_price.base.asset_id == base_asset.id) {
                base_balance += o.for_sale / Math.pow(10, base_asset.precision);
            }
            else if (o.sell_price.base.asset_id == quote_asset.id) {
                quote_balance += o.for_sale / Math.pow(10, quote_asset.precision);
            }
        });

        if (!base_balance) {
            return 1;
        }
        if (!quote_balance) {
            return 0;
        }
        return {
            price: marketPrice,
            ratio: quote_balance * marketPrice / (base_balance + quote_balance * marketPrice)
        }
    })
}

function get_target_order_data(account, base_asset_symbol, quote_asset_symbol, target_price, target_ratio) {
    return Promise.all([
        cache.get_full_account(account, true),
        cache.get_assets([base_asset_symbol, quote_asset_symbol]),
    ]).then(results => {
        var balances = results[0].balances;
        var base_asset = results[1][0];
        var quote_asset = results[1][1];
        var base_balance, quote_balance;

        balances.forEach((balance) => {
            if (balance.asset_type == base_asset.id) {
                base_balance = balance.balance / Math.pow(10, base_asset.precision);
            }
            else if (balance.asset_type == quote_asset.id) {
                quote_balance = balance.balance / Math.pow(10, quote_asset.precision);
            }
        })
        results[0].limit_orders.forEach(o => {
            if (o.sell_price.base.asset_id == base_asset.id) {
                base_balance += o.for_sale / Math.pow(10, base_asset.precision);
            }
            else if (o.sell_price.base.asset_id == quote_asset.id) {
                quote_balance += o.for_sale / Math.pow(10, quote_asset.precision);
            }
        });
        var targetRatio = target_ratio / (1 - target_ratio)
        var diff_base = (base_balance * targetRatio - quote_balance * target_price) / (1.0 + targetRatio);
        var diff_quote = diff_base / target_price;

        return {
            is_buy: diff_quote > 0,
            quote_amount: Math.abs(diff_quote),
            base_amount: Math.abs(diff_base)
        }
        // target_ratio = (quote_balance + qdiff)*target_price / (base_balance - qdiff *target_price +  (quote_balance + qdiff)*target_price)
        // target_ratio * (base_balance - qdiff *target_price +  (quote_balance + qdiff)*target_price) =(quote_balance + qdiff)*target_price
        // target_ratio * base_balance - qdiff * target_price * target_ratio 
    })

}

function get_account_orders(account, base_asset_symbol, quote_asset_symbol) {
    return Promise.all([
        cache.get_full_account(account, true),
        cache.get_assets([base_asset_symbol, quote_asset_symbol]),
        marketData.getLatestFillPrice(base_asset_symbol, quote_asset_symbol),
        marketData.getMarketPrice(base_asset_symbol, quote_asset_symbol),
    ]).then(results => {
        var base_asset = results[1][0];
        var quote_asset = results[1][1];
        var orders = results[0].limit_orders.filter(o => {
            return o.sell_price.base.asset_id == base_asset.id && o.sell_price.quote.asset_id == quote_asset.id
                || o.sell_price.base.asset_id == quote_asset.id && o.sell_price.quote.asset_id == base_asset.id;
        });
        return orders.map(o => {
            var r = { raw_order: o, parsed: {} };
            r.parsed.is_buy = o.sell_price.base.asset_id == base_asset.id;
            if (r.parsed.is_buy) {
                r.parsed.base_amount = o.sell_price.base.amount / Math.pow(10, base_asset.precision);
                r.parsed.quote_amount = o.sell_price.quote.amount / Math.pow(10, quote_asset.precision);
            }
            else {
                r.parsed.base_amount = o.sell_price.quote.amount / Math.pow(10, base_asset.precision);
                r.parsed.quote_amount = o.sell_price.base.amount / Math.pow(10, quote_asset.precision);
            }
            r.parsed.price = r.parsed.base_amount / r.parsed.quote_amount;
            return r;
        });
    });
}

module.exports = {
    get_account_asset_ratio: get_account_asset_ratio,
    get_target_order_data: get_target_order_data,
    get_account_orders: get_account_orders,
}