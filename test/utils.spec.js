'use strict';

const chai = require('chai');

const utils = require('../lib/utils');
const { keys, queries } = require('./mocks/datastore');

const [query1, query2, query3] = queries;
const [key1, , , , key5] = keys;

const { expect } = chai;
const { dsKeyToString, dsQueryToString } = utils.datastore;

describe('utils', () => {
    describe('dsKeyToString', () => {
        it('should convert the query to string', () => {
            const str1 = dsKeyToString(key1, { hash: false });
            const str2 = dsKeyToString(key5, { hash: false });

            expect(str1).equal('nsUser111');
            expect(str2).equal('GranDadJohnDadMickUser555');
        });

        it('should throw an error if no Key passed', () => {
            const fn = () => dsKeyToString();
            expect(fn).throws('Key cannot be undefined.');
        });
    });

    describe('dsQueryToString', () => {
        it('should convert the query to string', () => {
            const str1 = dsQueryToString(query1, { hash: false });
            const str2 = dsQueryToString(query2, { hash: false });
            const str3 = dsQueryToString(query3, { hash: false });

            expect(str1).equal(
                'Company|com.domain.dev|name=Sympresafield1<123field2>789__key__HAS_ANCESTORParent123|field1field2|10|5|size-|namesize|X|Y' // eslint-disable-line
            );
            expect(str2).equal('User||name=john||-1|-1|phone+|||');
            expect(str3).equal('Task||__key__>TasksomeTask||-1|-1||__key__||');
        });
    });
});
