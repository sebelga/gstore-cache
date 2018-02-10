'use strict';

const ds = require('@google-cloud/datastore')();

const key1 = ds.key({
    namespace: 'ns',
    path: ['User', 111],
});
const key2 = ds.key(['User', 222]);
const key3 = ds.key(['User', 333]);
const key4 = ds.key(['User', 444]);
const key5 = ds.key(['GranDad', 'John', 'Dad', 'Mick', 'User', 555]);

const entity1 = { name: 'John' };
const entity2 = { name: 'Mick' };
const entity3 = { name: 'Carol' };
const entity4 = { name: 'Greg' };
const entity5 = { name: 'Tito' };

entity1[ds.KEY] = key1;
entity2[ds.KEY] = key2;
entity3[ds.KEY] = key3;
entity4[ds.KEY] = key4;
entity5[ds.KEY] = key5;

const query1 = ds
    .createQuery('com.domain.dev', 'Company')
    .filter('name', 'Sympresa')
    .filter('field1', '<', 123)
    .filter('field2', '>', 789)
    .groupBy(['field1', 'field2'])
    .hasAncestor(ds.key(['Parent', 123]))
    .limit(10)
    .offset(5)
    .order('size', { descending: true })
    .select(['name', 'size'])
    .start('X')
    .end('Y');

const query2 = ds
    .createQuery('User')
    .filter('name', 'john')
    .order('phone');

const query3 = ds
    .createQuery('Task')
    .select('__key__')
    .filter('__key__', '>', ds.key(['Task', 'someTask']));

module.exports = {
    keys: [key1, key2, key3, key4, key5],
    entities: [entity1, entity2, entity3, entity4, entity5],
    queries: [query1, query2, query3],
};
