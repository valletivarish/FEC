package com.guardianedge.backend.handlers;

import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

/** Small conversion helpers so handlers don't repeat AttributeValue boilerplate. */
final class DynamoAttr {

    private DynamoAttr() {
    }

    static AttributeValue s(String value) {
        return AttributeValue.builder().s(value).build();
    }

    static AttributeValue n(long value) {
        return AttributeValue.builder().n(Long.toString(value)).build();
    }
}
