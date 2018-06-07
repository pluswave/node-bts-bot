'use strict'

const cache = require('./bts-cache');
const broadcast = require('./bts-broadcast');
const accountMarket = require('./bts-account-market');
const fs = require('fs');
function simple_bot(account, active_key_wif, strategy) {
    const default_state = {
        min_ratio_price: 999999,
        max_ratio_price: -1,
        higher: {
            target_price: 0
        },
        lower: {
            target_price: 0
        },
        direction: 'up',
        direction_count: 0
    }
    var state;
    var fileName = './_state_' + account + '.json';
    function loadState(){
        var s
        try {
            s = fs.readFileSync(fileName, {
                encoding: 'utf-8'
            });
            state = JSON.parse(s);
        }
        catch (e){
            state = default_state;
        }
    }

    function saveState(){
        fs.writeFileSync(fileName, JSON.stringify(state), {
            encoding: 'utf8'
        })
    }
    loadState();
    var timer = null;

    var in_check = false;
    function check() {
        if (in_check) {
            console.log('in_check');
            // setTimeout(check, 1000);
            timer = timer || setInterval(check, 10 * 1000);
            return;
        }
        in_check = true;
        console.log('checking ....');
        accountMarket.get_account_orders(account, strategy.base_asset_symbol, strategy.quote_asset_symbol)
            .then((o) => {
                var cancelPromise, calPromise, filledPrice = 0;
                var new_lower, new_higher;
                var cur_dir;
                if (o.length == 1) { // cancel and update target
                    if (Math.abs(o[0].parsed.price - state.higher.target_price) < 0.0001) {
                        console.log('lower filled');
                        filledPrice = state.lower.target_price;
                        cur_dir = 'down';
                    }
                    else if (Math.abs(o[0].parsed.price - state.lower.target_price) < 0.0001) {
                        console.log('higher filled');
                        filledPrice = state.higher.target_price;
                        cur_dir = 'up';
                    }
                    if( cur_dir == state.direction ){
                        state.direction_count ++;
                    }
                    else {
                        state.direction_count = 0;
                    }
                    state.direction = cur_dir;
                    cancelPromise = broadcast.doCancelOrder(account, active_key_wif, o[0].raw_order.id)
                }
                if( o.length < 2) {
                    calPromise = accountMarket.get_account_asset_ratio(account, strategy.base_asset_symbol, strategy.quote_asset_symbol, filledPrice)
                        .then(r => {
                            var down_price_diff, up_price_diff;
                            if( cur_dir == 'down' ){
                                down_price_diff = strategy.price_diff *  Math.pow( (strategy.price_adjust_ratio || 1) , state.direction_count);
                                up_price_diff = strategy.price_diff;
                            }
                            else{
                                down_price_diff = strategy.price_diff ;
                                up_price_diff = strategy.price_diff * Math.pow( (strategy.price_adjust_ratio || 1) , state.direction_count);
                            }
                            new_lower = {
                                target_price: r.price - down_price_diff,
                                target_ratio: r.ratio + strategy.ratio_diff
                            };
                            new_higher = {
                                target_price: r.price + up_price_diff,
                                target_ratio: r.ratio - strategy.ratio_diff
                            }
                            if( new_lower.target_price > state.min_ratio_price ){
                                new_lower.target_ratio = strategy.min_ratio;
                            }
                            if( new_higher.target_price < state.max_ratio_price ){
                                new_higher.target_ratio = strategy.max_ratio;
                            }
                            if (new_lower.target_ratio > strategy.max_ratio) {
                                new_lower.target_ratio = strategy.max_ratio;
                                state.max_ratio_price = new_lower.target_price;
                            }
                            if (new_higher.target_ratio < strategy.min_ratio) {
                                new_higher.target_ratio = strategy.min_ratio;
                                state.min_ratio_price = new_higher.target_price;
                            }
                        })
                }
                if( cancelPromise ) {
                    cancelPromise.then( ()=>{
                    }).catch ((e)=>{});
                }
                return calPromise && calPromise.then(() => {
                    return Promise.all([
                        accountMarket.get_target_order_data(
                            account,
                            strategy.base_asset_symbol,
                            strategy.quote_asset_symbol,
                            new_lower.target_price,
                            new_lower.target_ratio),
                        accountMarket.get_target_order_data(
                            account,
                            strategy.base_asset_symbol,
                            strategy.quote_asset_symbol,
                            new_higher.target_price,
                            new_higher.target_ratio)
                    ])
                }).then((r) => {
                    console.log(r);
                    if (!r[0].is_buy && !r[1].is_buy) {
                        r[0] = r[1];
                        r[0].quote_amount = r[0].quote_amount  / 2;
                        r[0].base_amount = r[0].base_amount  / 2;
                        new_lower = new_higher;
                    }
                    else if( r[0].is_buy && r[1].is_buy ){
                        r[1] = r[0];
                        r[0].quote_amount = r[0].quote_amount  / 2;
                        r[0].base_amount = r[0].base_amount  / 2;
                        new_higher = new_lower;
                    }
                    else if( !r[0].is_buy && r[1].is_buy ){
                        throw ('买卖反了，程序需要调整');
                    }
                    if( Math.max(r[0].quote_amount,r[0].base_amount) < 10 
                    || Math.max(r[1].quote_amount, r[1].base_amount) < 10 ){
                        // 边界条件无法下单
                        throw ('买单或者卖单太小了，需要调整');
                    }
                    return broadcast.doPlaceOrders(account, active_key_wif, [{
                        base_asset_symbol: strategy.base_asset_symbol,
                        quote_asset_symbol: strategy.quote_asset_symbol,
                        is_buy: r[0].is_buy,
                        price_float: new_lower.target_price,
                        quote_amount_float: r[0].quote_amount
                    }, {
                        base_asset_symbol: strategy.base_asset_symbol,
                        quote_asset_symbol: strategy.quote_asset_symbol,
                        is_buy: r[1].is_buy,
                        price_float: new_higher.target_price,
                        quote_amount_float: r[1].quote_amount
                    }])
                }).then((r) => {
                    state.lower = new_lower;
                    state.higher = new_higher;
                    console.log(state);
                    saveState();
                    setTimeout(()=>{
                        in_check = false;
                    }, 10000);
                    if( timer ) {
                        clearInterval(timer);
                        timer = null;
                    }
                    return "from orders";
                })
            }).then((r) => {
                if ( r != 'from orders'){
                    in_check = false;
                }
            }).catch( (e)=>{
                console.log(e);
                in_check = false;
                // process.exit(1)
                timer = timer || setInterval(check, 10 * 1000);
            })
    }

    check();

    cache.add_full_account_change_callback((s) => {
        console.log('account change', s);
        if (s == account) {
            check();
        }
    })
}

module.exports = {
    simple_bot: simple_bot
}