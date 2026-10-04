// SubagentStart: subagents run their own tool calls, so they need the same rules.
import { readLevel } from '../config';
import { getInstructions } from '../instructions';
import { runHook, emitContext } from './common';

runHook('SubagentStart', () => {
    const level = readLevel();
    if (level !== 'off') emitContext('SubagentStart', getInstructions(level));
});
