'use strict';

const getCallback = (...args) => args.pop();

module.exports = (name = 'memory') => ({
    store: {
        name,
        options: {},
        getClient: () => ({
            end: () => {},
        }),
        reset: (...args) => getCallback(...args)(),
        set: (...args) => getCallback(...args)(),
        mset: (...args) => getCallback(...args)(),
        get: (...args) => getCallback(...args)(),
        mget: (...args) => getCallback(...args)(),
    },
});
