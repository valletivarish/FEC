package edu.msc.chainfrost.fog.tempfog;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ExcursionRuleTest {

    @Test
    void withinDefaultToleranceIsNotAnExcursion() {
        assertFalse(ExcursionRule.isExcursionActive(-18.5, -20.0));
    }

    @Test
    void exactlyAtToleranceBoundaryIsNotAnExcursion() {
        assertFalse(ExcursionRule.isExcursionActive(-18.0, -20.0));
    }

    @Test
    void justOverToleranceBoundaryIsAnExcursion() {
        assertTrue(ExcursionRule.isExcursionActive(-17.9, -20.0));
    }

    @Test
    void excursionDetectedBelowSetpointToo() {
        assertTrue(ExcursionRule.isExcursionActive(-23.0, -20.0));
    }

    @Test
    void customToleranceIsRespected() {
        assertFalse(ExcursionRule.isExcursionActive(-15.5, -20.0, 5.0));
        assertTrue(ExcursionRule.isExcursionActive(-14.9, -20.0, 5.0));
    }
}
