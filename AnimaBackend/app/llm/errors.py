class LLMError(Exception):
    """A provider call failed for a reason the user can act on (bad key, bad URL, ...).

    `message` is user-facing and shown verbatim in the UI.

    `explained` marks a message that says more than the provider's raw error
    does (e.g. the raw one is an HTML page), so callers that normally prefer
    the raw text show this instead.
    """

    def __init__(self, message: str, explained: bool = False):
        super().__init__(message)
        self.message = message
        self.explained = explained
