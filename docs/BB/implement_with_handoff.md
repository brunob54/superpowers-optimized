I would like to implement an alternative to the skill executing plans. 
Each task of the plan will be implemented sequentially. 
Each task will use a sub-agent to minimize context use. The goal is to minimize context use
by the implementation orchestrator. Another goal is to be able to resume the implementation
in case the orchestrator had to stop for any reson (e.g. wait to reset usage limit)
When one task is completed, the implementation orchestrator will generate a handoff document
saved into an MD file. When starting the next task, the implementation orchestrator will start
the new task using the handoff document which is provided to the implementation agent.
The implementation must run 100% autonomously.