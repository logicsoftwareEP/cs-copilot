-- Creates the PowerBI score export table in the AccountsControl database.
-- Run ONCE as an admin. Then replace <app_user> with the database user
-- mapped to the app's SQL_LOGIN and run the GRANT.
--
-- The app does DELETE + bulk INSERT on every sync (full snapshot replace),
-- so it needs SELECT, INSERT, DELETE — not UPDATE.

IF OBJECT_ID('[analytics].[AccountHealthScores]', 'U') IS NULL
BEGIN
    CREATE TABLE [analytics].[AccountHealthScores] (
        ClientId   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        Score      INT          NULL,         -- 0-100, NULL when not computable
        Tier       NVARCHAR(20) NOT NULL,     -- healthy | watch | at-risk | critical | unmapped
        ScoreDate  DATE         NOT NULL,     -- date the score was computed for
        UpdatedAt  DATETIME2    NOT NULL      -- when the sync wrote this row
    );
END;
GO

GRANT SELECT, INSERT, DELETE ON [analytics].[AccountHealthScores] TO [<app_user>];
GO
