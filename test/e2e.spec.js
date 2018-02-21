'use strict';

const { argv } = require('yargs');

const Datastore = require('@google-cloud/datastore');
const chai = require('chai');
const sinon = require('sinon');
const requireUncached = require('require-uncached');

const gstoreCache = requireUncached('../lib');
// const { string } = require('../lib/utils');
// const { queries } = require('./mocks/datastore');

const ds = new Datastore({ projectId: 'gstore-cache-e2e-tests' });

const { expect, assert } = chai;

const key1 = ds.key(['User', 123]);
const key2 = ds.key(['User', 456]);
const key3 = ds.key(['User', 789]);
const allKeys = [key1, key2, key3];

const data1 = { name: 'John Snow' };
// const data2 = { name: 'Mick Jagger' };
// const data3 = { name: 'Keith Richards' };

const cleanUp = cb => {
    ds.delete(allKeys).then(cb);
};

describe('e2e (Datastore & Memory cache)', () => {
    let cache;

    beforeEach(function integrationTest(done) {
        if (!argv.e2e === true) {
            // Skip e2e tests suite
            this.skip();
        }

        cache = gstoreCache.init({ datastore: ds });
        const onReady = () => {
            done();
        };
        cache.on('ready', onReady);
    });

    afterEach(done => {
        cache.removeAllListeners();
        cleanUp(() => done());
    });

    it('check that Local Datastore is up and running', () =>
        ds.get(key1).then(res => {
            expect(typeof res[0]).equal('undefined');

            return ds
                .save({ key: key1, data: data1 })
                .then(() => ds.get(key1))
                .then(res2 => {
                    expect(res2[0]).deep.equal(data1);
                });
        }));

    describe('gstoreCache.keys', () => {
        beforeEach(function TestGstoreCacheKeys() {
            if (!argv.e2e === true) {
                // Skip e2e tests suite
                this.skip();
            }
            sinon.spy(ds, 'get');
        });

        afterEach(() => {
            ds.get.restore();
        });

        it('should add data to cache', () =>
            ds.save({ key: key1, data: data1 }).then(() =>
                cache.keys.get(key1).then(result1 => {
                    assert.isUndefined(result1); // make sure the cache is empty
                    return ds
                        .get(key1)
                        .then(result2 => cache.keys.set(key1, result2[0]))
                        .then(() => cache.keys.get(key1))
                        .then(result3 => {
                            expect(result3).deep.equal(data1);
                        });
                })
            ));

        describe('wrap', () => {
            it('should add data to cache', () =>
                ds.save({ key: key1, data: data1 }).then(() =>
                    cache.keys
                        .wrap(key1)
                        .then(result => {
                            expect(result).deep.equal(data1);
                        })
                        .then(() =>
                            cache.keys.wrap(key1).then(result => {
                                expect(result).deep.equal(data1);
                                expect(result[ds.KEY]).equal(key1);
                                expect(ds.get.callCount).equal(1);
                            })
                        )
                ));

            it('should return undefined when Key not found', () =>
                cache.keys.wrap(key1).then(result => {
                    assert.isUndefined(result);
                }));
        });

        describe('set', () => {
            it('should set the key in the cache', () =>
                cache.keys
                    .get(key1)
                    .then(result => {
                        assert.isUndefined(result);
                    })
                    .then(() => cache.keys.set(key1, data1))
                    .then(() => cache.keys.wrap(key1))
                    .then(result => {
                        expect(result).contains(data1);
                        expect(ds.get.called).equal(false);
                    })
                    .then(() => cache.keys.get(key1))
                    .then(result => {
                        expect(result).contains(data1);
                        expect(result[ds.KEY]).equal(key1);
                    }));
        });
    });

    describe('gstoreCache.queries', () => {
        const k1 = ds.key(['Parent', 'default', 'User', 222]);
        const k2 = ds.key(['Parent', 'default', 'User', 333]);
        const user1 = { name: 'john', age: 20 };
        const user2 = { name: 'mick', age: 20 };

        const query = ds
            .createQuery('User')
            .filter('age', 20)
            .hasAncestor(ds.key(['Parent', 'default']));

        beforeEach(function TestGstoreCacheQueries(done) {
            if (!argv.e2e === true) {
                // Skip e2e tests suite
                this.skip();
            }
            ds.save([{ key: k1, data: user1 }, { key: k2, data: user2 }]).then(() => done());
        });

        it('should add query data to cache', () =>
            cache.queries.get(query).then(result1 => {
                assert.isUndefined(result1); // make sure the cache is empty
                return query
                    .run()
                    .then(result2 => cache.queries.set(query, result2[0]))
                    .then(() => cache.queries.get(query))
                    .then(result3 => {
                        expect(result3).deep.equal([user1, user2]);
                    });
            }));
    });
});
