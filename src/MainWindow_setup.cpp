#include "MainWindow.h"

#include <QAbstractItemView>
#include <QAction>
#include <QApplication>
#include <QDateTime>
#include <QFileInfo>
#include <QFrame>
#include <QHBoxLayout>
#include <QIcon>
#include <QListWidget>
#include <QMenu>
#include <QPushButton>
#include <QSizePolicy>
#include <Qsci/qsciscintilla.h>
#include <QSplitter>
#include <QStackedWidget>
#include <QTextEdit>
#include <QVBoxLayout>

#include "NoteRowDelegate.h"

void MainWindow::setupUi() {
    setMenuBar(nullptr);

    auto *central = new QWidget(this);
    setCentralWidget(central);
    auto *outer = new QHBoxLayout(central);
    outer->setContentsMargins(0, 0, 0, 0);
    outer->setSpacing(0);

    leftToolBar_ = new QFrame(central);
    leftToolBar_->setObjectName(QStringLiteral("toolColumn"));
    leftToolBar_->setFrameShape(QFrame::NoFrame);
    leftToolBar_->setFixedWidth(118);
    auto *lv = new QVBoxLayout(leftToolBar_);
    lv->setContentsMargins(8, 10, 8, 10);
    lv->setSpacing(6);

    auto mkBtn = [](const QString &t, QWidget *p) {
        auto *b = new QPushButton(t, p);
        b->setIcon(QIcon());
        b->setFlat(true);
        b->setCursor(Qt::PointingHandCursor);
        return b;
    };

    auto *newBtn = mkBtn(QStringLiteral("New"), leftToolBar_);
    auto *openBtn = mkBtn(QStringLiteral("Open"), leftToolBar_);
    auto *closeBtn = mkBtn(QStringLiteral("Close"), leftToolBar_);

    auto *reopenBtn = new QPushButton(QStringLiteral("Reopen"), leftToolBar_);
    reopenBtn->setObjectName(QStringLiteral("reopenBtn"));
    reopenBtn->setIcon(QIcon());
    reopenBtn->setFlat(true);
    reopenBtn->setCursor(Qt::PointingHandCursor);
    reopenMenu_ = new QMenu(reopenBtn);
    reopenBtn->setMenu(reopenMenu_);

    auto *pushBtn = mkBtn(QStringLiteral("Push"), leftToolBar_);
    wysiwygBtn_ = new QPushButton(QStringLiteral("WYSIWYG"), leftToolBar_);
    wysiwygBtn_->setCheckable(true);
    wysiwygBtn_->setIcon(QIcon());
    wysiwygBtn_->setFlat(true);
    wysiwygBtn_->setCursor(Qt::PointingHandCursor);
    auto *quitBtn = mkBtn(QStringLiteral("Quit"), leftToolBar_);

    lv->addWidget(newBtn);
    lv->addWidget(openBtn);
    lv->addWidget(closeBtn);
    lv->addWidget(reopenBtn);
    lv->addSpacing(8);
    lv->addWidget(pushBtn);
    lv->addWidget(wysiwygBtn_);
    lv->addStretch();
    lv->addWidget(quitBtn);

    connect(reopenMenu_, &QMenu::aboutToShow, this, [this] {
        reopenMenu_->clear();
        pruneRecentClosed();
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        constexpr qint64 kReopenWindowMs = 24LL * 60 * 60 * 1000;
        for (const ClosedEntry &e : recentClosed_) {
            if (now - e.closedMs > kReopenWindowMs)
                continue;
            QString label = QFileInfo(e.path).fileName();
            QAction *a = reopenMenu_->addAction(label);
            a->setData(e.path);
        }
        if (reopenMenu_->actions().isEmpty())
            reopenMenu_->addAction(QStringLiteral("(none)"))->setEnabled(false);
    });
    connect(reopenMenu_, &QMenu::triggered, this, [this](QAction *a) {
        if (!a->data().isValid())
            return;
        const QString p = a->data().toString();
        if (p.isEmpty())
            return;
        flushSave();
        const QString nd = notesDir() + QLatin1Char('/');
        if (!p.startsWith(nd))
            externalPaths_.insert(p);
        refreshNoteList();
        if (pathToItem_.contains(p))
            list_->setCurrentItem(pathToItem_.value(p));
    });

    connect(newBtn, &QPushButton::clicked, this, &MainWindow::onNewNote);
    connect(openBtn, &QPushButton::clicked, this, &MainWindow::onOpenFile);
    connect(closeBtn, &QPushButton::clicked, this, &MainWindow::onCloseNote);
    connect(pushBtn, &QPushButton::clicked, this, &MainWindow::onPush);
    connect(wysiwygBtn_, &QPushButton::toggled, this, [this](bool on) {
        if (on == wysiwygMode_)
            return;
        wysiwygMode_ = on;
        if (wysiwygMode_) {
            syncWysiwygFromSource();
            editorStack_->setCurrentWidget(richEditor_);
        } else {
            syncSourceFromWysiwyg();
            editorStack_->setCurrentWidget(sourceEditor_);
        }
        applyEditorFontSize();
        persistStateSoon();
    });
    connect(quitBtn, &QPushButton::clicked, qApp, &QApplication::quit);

    split_ = new QSplitter(Qt::Horizontal, central);
    list_ = new QListWidget(split_);
    list_->setMinimumWidth(160);
    list_->setUniformItemSizes(false);
    list_->setWordWrap(false);
    list_->setTextElideMode(Qt::ElideRight);
    list_->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    list_->setItemDelegate(new NoteRowDelegate(list_));

    auto *editorCol = new QWidget(split_);
    auto *ev = new QVBoxLayout(editorCol);
    ev->setContentsMargins(0, 0, 0, 0);
    ev->setSpacing(0);

    mdPalette_ = new QFrame(editorCol);
    mdPalette_->setObjectName(QStringLiteral("mdPalette"));
    auto *ph = new QHBoxLayout(mdPalette_);
    ph->setContentsMargins(6, 4, 6, 4);
    ph->setSpacing(4);
    const auto addPaletteBtn = [mkBtn, ph, palette = mdPalette_](const QString &t) {
        auto *b = mkBtn(t, palette);
        b->setSizePolicy(QSizePolicy::Minimum, QSizePolicy::Fixed);
        ph->addWidget(b);
        return b;
    };
    connect(addPaletteBtn(QStringLiteral("Bold")), &QPushButton::clicked, this, [this] {
        insertMarkdownAround(QStringLiteral("**"), QStringLiteral("**"));
    });
    connect(addPaletteBtn(QStringLiteral("Italic")), &QPushButton::clicked, this, [this] {
        insertMarkdownAround(QStringLiteral("*"), QStringLiteral("*"));
    });
    connect(addPaletteBtn(QStringLiteral("Code")), &QPushButton::clicked, this, [this] {
        insertMarkdownAround(QStringLiteral("`"), QStringLiteral("`"));
    });
    connect(addPaletteBtn(QStringLiteral("H1")), &QPushButton::clicked, this, [this] {
        insertMarkdownLinePrefix(QStringLiteral("# "));
    });
    connect(addPaletteBtn(QStringLiteral("H2")), &QPushButton::clicked, this, [this] {
        insertMarkdownLinePrefix(QStringLiteral("## "));
    });
    connect(addPaletteBtn(QStringLiteral("H3")), &QPushButton::clicked, this, [this] {
        insertMarkdownLinePrefix(QStringLiteral("### "));
    });
    connect(addPaletteBtn(QStringLiteral("List")), &QPushButton::clicked, this, [this] {
        insertMarkdownLinePrefix(QStringLiteral("- "));
    });
    connect(addPaletteBtn(QStringLiteral("Quote")), &QPushButton::clicked, this, [this] {
        insertMarkdownLinePrefix(QStringLiteral("> "));
    });
    connect(addPaletteBtn(QStringLiteral("Link")), &QPushButton::clicked, this, [this] {
        insertMarkdownAround(QStringLiteral("["), QStringLiteral("](url)"));
    });
    ph->addStretch();

    editorStack_ = new QStackedWidget(editorCol);
    sourceEditor_ = new QsciScintilla(editorStack_);
    sourceEditor_->setUtf8(true);
    sourceEditor_->setMarginLineNumbers(0, true);
    sourceEditor_->setMarginWidth(0, QStringLiteral("0000"));
    sourceEditor_->setBraceMatching(QsciScintilla::SloppyBraceMatch);
    sourceEditor_->setAutoIndent(true);
    sourceEditor_->viewport()->installEventFilter(this);

    richEditor_ = new QTextEdit(editorStack_);
    richEditor_->setAcceptRichText(true);
    richEditor_->viewport()->installEventFilter(this);

    editorStack_->addWidget(sourceEditor_);
    editorStack_->addWidget(richEditor_);

    ev->addWidget(mdPalette_);
    ev->addWidget(editorStack_, 1);

    split_->addWidget(list_);
    split_->addWidget(editorCol);
    split_->setStretchFactor(1, 1);
    connect(split_, &QSplitter::splitterMoved, this, [this](int, int) {
        if (list_)
            list_->doItemsLayout();
    });

    outer->addWidget(leftToolBar_);
    outer->addWidget(split_, 1);

    connect(list_, &QListWidget::currentItemChanged, this, &MainWindow::onListSelectionChanged);
    connect(sourceEditor_, &QsciScintilla::textChanged, this, &MainWindow::onSourceTextChanged);
    connect(richEditor_, &QTextEdit::textChanged, this, &MainWindow::onRichTextChanged);
}
