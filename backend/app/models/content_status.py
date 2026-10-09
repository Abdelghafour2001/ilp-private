"""The lifecycle a piece of shared content moves through.

One vocabulary, so a course, a training and a pathway answer "is this visible?"
the same way. Before this, trainings had draft/published/archived while courses
and pathways had a boolean that could not express archived at all — two
vocabularies for one idea, and the boolean's default of True is what let anyone
publish straight into the catalogue.

`ARCHIVED` is the reason this is not a boolean. Content somebody has completed
must not be deleted, or their learning record loses an entry it earned; it is
retired from the catalogue instead and stays readable on the record.
"""

DRAFT = "draft"
PENDING = "pending"
PUBLISHED = "published"
ARCHIVED = "archived"

STATUSES = (DRAFT, PENDING, PUBLISHED, ARCHIVED)

# What a learner may find in a catalogue. Everything else is visible to its
# author and to the people who curate.
VISIBLE = (PUBLISHED,)
