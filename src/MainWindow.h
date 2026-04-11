#pragma once

#include <QFont>
#include <QHash>
#include <QJsonObject>
#include <QMainWindow>
#include <QSet>
#include <QString>
#include <QTimer>
#include <QVector>

class QCloseEvent;
class QEvent;
class QListWidget;
class QListWidgetItem;
class QFrame;
class QMenu;
class QPushButton;
class QResizeEvent;
class QSplitter;
class QStackedWidget;
class QTextEdit;
class QsciScintilla;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

    void zoomAppByFactor(double factor);
    void resetAppZoom();

protected:
    void closeEvent(QCloseEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    bool eventFilter(QObject *watched, QEvent *event) override;

private slots:
    void onListSelectionChanged();
    void onSourceTextChanged();
    void onRichTextChanged();
    void flushSave();
    void onPush();
    void onOpenFile();
    void onCloseNote();
    void onNewNote();
    void onCycleFile(int delta);
    void persistStateSoon();

private:
    void setupUi();
    void applyChrome();
    QString findRepoRoot() const;
    QString notesDir() const;
    QString stateFilePath() const;
    void ensureNotesDir();
    void refreshNoteList();
    QString displayTitleForPath(const QString &path, const QString &contentPreview = QString()) const;
    void openPath(const QString &path);
    void registerClosedForReopen(const QString &path);
    void pruneRecentClosed();
    void saveRecentClosed();
    void loadRecentClosed();
    void applyAppZoom();
    void applyEditorFontSize();
    void updateSidebarTitleForCurrent();
    void toggleNotesSidebar();
    void updateSourceLexer(const QString &path);
    QString currentPayload() const;
    void setBothEditorsText(const QString &markdownUtf8);
    void insertMarkdownAround(const QString &before, const QString &after);
    void insertMarkdownLinePrefix(const QString &prefix);
    void loadUiState();
    void saveUiState();
    QJsonObject captureCursorState() const;
    void restoreCursorState(const QJsonObject &o);
    void syncWysiwygFromSource();
    void syncSourceFromWysiwyg();

    QListWidget *list_ = nullptr;
    QsciScintilla *sourceEditor_ = nullptr;
    QTextEdit *richEditor_ = nullptr;
    QStackedWidget *editorStack_ = nullptr;
    QFrame *mdPalette_ = nullptr;
    QPushButton *wysiwygBtn_ = nullptr;
    QSplitter *split_ = nullptr;
    QFrame *leftToolBar_ = nullptr;
    QMenu *reopenMenu_ = nullptr;

    bool notesSidebarVisible_ = true;
    int savedNotesSidebarWidth_ = 220;
    bool wysiwygMode_ = false;

    QString repoRoot_;
    QString currentPath_;
    bool loadingEditor_ = false;
    QTimer saveTimer_;
    QTimer persistTimer_;

    QHash<QString, QListWidgetItem *> pathToItem_;

    double appZoom_ = 1.0;
    QFont baseAppFont_;
    double editorPointSize_ = 12.0;
    double baseEditorPointSizeSaved_ = 12.0;

    struct ClosedEntry {
        QString path;
        qint64 closedMs = 0;
    };
    QVector<ClosedEntry> recentClosed_;

    int untitledSeq_ = 1;
    QSet<QString> externalPaths_;

    QHash<QString, QJsonObject> cursorByFile_;
    QString pendingRestorePath_;
};
