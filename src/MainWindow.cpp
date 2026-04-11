#include "MainWindow.h"

#include <QApplication>
#include <QDateTime>
#include <QFontInfo>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QList>
#include <QListWidget>
#include <QListWidgetItem>
#include <QRegularExpression>
#include <QShortcut>
#include <QSplitter>
#include <QTimer>
#include <QTextEdit>
#include <Qsci/qsciscintilla.h>
#include <algorithm>

namespace {

QString elideFirstLine(const QString &s) {
    QString t = s;
    t.replace(QLatin1Char('\n'), QLatin1Char(' '));
    t.replace(QLatin1Char('\r'), QLatin1Char(' '));
    t = t.trimmed();
    if (t.size() > 72)
        t = t.left(72) + QLatin1String("…");
    return t;
}

} // namespace

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    repoRoot_ = findRepoRoot();
    ensureNotesDir();
    baseAppFont_ = QApplication::font();
    double basePt = baseAppFont_.pointSizeF();
    if (basePt <= 0) {
        const QFontInfo fi(baseAppFont_);
        basePt = fi.pointSizeF();
    }
    if (basePt <= 0)
        basePt = 10.0;
    editorPointSize_ = basePt + 1.0;
    baseEditorPointSizeSaved_ = editorPointSize_;

    setWindowTitle(QString());
    resize(1000, 640);

    setupUi();
    loadUiState();
    applyChrome();
    loadRecentClosed();

    saveTimer_.setSingleShot(true);
    connect(&saveTimer_, &QTimer::timeout, this, &MainWindow::flushSave);
    persistTimer_.setSingleShot(true);
    connect(&persistTimer_, &QTimer::timeout, this, [this] { saveUiState(); });

    auto *scNew = new QShortcut(QKeySequence::New, this);
    scNew->setContext(Qt::ApplicationShortcut);
    connect(scNew, &QShortcut::activated, this, &MainWindow::onNewNote);
    auto *scOpen = new QShortcut(QKeySequence::Open, this);
    scOpen->setContext(Qt::ApplicationShortcut);
    connect(scOpen, &QShortcut::activated, this, &MainWindow::onOpenFile);
    auto *scClose = new QShortcut(QKeySequence::Close, this);
    scClose->setContext(Qt::ApplicationShortcut);
    connect(scClose, &QShortcut::activated, this, &MainWindow::onCloseNote);
    auto *scW = new QShortcut(QKeySequence(QStringLiteral("Ctrl+W")), this);
    scW->setContext(Qt::ApplicationShortcut);
    connect(scW, &QShortcut::activated, this, &MainWindow::onCloseNote);
    auto *scQuit = new QShortcut(QKeySequence::Quit, this);
    scQuit->setContext(Qt::ApplicationShortcut);
    connect(scQuit, &QShortcut::activated, qApp, &QApplication::quit);
    auto *scSidebar = new QShortcut(QKeySequence(QStringLiteral("Ctrl+B")), this);
    scSidebar->setContext(Qt::ApplicationShortcut);
    connect(scSidebar, &QShortcut::activated, this, &MainWindow::toggleNotesSidebar);
    auto *scPgDn = new QShortcut(QKeySequence(QStringLiteral("Ctrl+PgDown")), this);
    scPgDn->setContext(Qt::ApplicationShortcut);
    connect(scPgDn, &QShortcut::activated, this, [this] { onCycleFile(1); });
    auto *scPgUp = new QShortcut(QKeySequence(QStringLiteral("Ctrl+PgUp")), this);
    scPgUp->setContext(Qt::ApplicationShortcut);
    connect(scPgUp, &QShortcut::activated, this, [this] { onCycleFile(-1); });

    auto *scZi = new QShortcut(QKeySequence::ZoomIn, this);
    scZi->setContext(Qt::ApplicationShortcut);
    connect(scZi, &QShortcut::activated, this, [this] { zoomAppByFactor(1.2); });
    auto *scZo = new QShortcut(QKeySequence::ZoomOut, this);
    scZo->setContext(Qt::ApplicationShortcut);
    connect(scZo, &QShortcut::activated, this, [this] { zoomAppByFactor(1.0 / 1.2); });
    auto *scZ0 = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_0), this);
    scZ0->setContext(Qt::ApplicationShortcut);
    connect(scZ0, &QShortcut::activated, this, &MainWindow::resetAppZoom);

    qApp->installEventFilter(this);
    refreshNoteList();
    if (!pendingRestorePath_.isEmpty()) {
        QString abs = pendingRestorePath_;
        if (!QFileInfo(abs).isAbsolute())
            abs = QDir(repoRoot_).absoluteFilePath(pendingRestorePath_);
        if (pathToItem_.contains(abs))
            list_->setCurrentItem(pathToItem_.value(abs));
        pendingRestorePath_.clear();
    }
    applyAppZoom();
}

void MainWindow::zoomAppByFactor(double factor) {
    appZoom_ *= factor;
    if (appZoom_ < 1e-6)
        appZoom_ = 1e-6;
    applyAppZoom();
    persistStateSoon();
}

void MainWindow::resetAppZoom() {
    appZoom_ = 1.0;
    editorPointSize_ = baseEditorPointSizeSaved_;
    applyAppZoom();
    persistStateSoon();
}

void MainWindow::toggleNotesSidebar() {
    if (!split_ || !list_)
        return;
    notesSidebarVisible_ = !notesSidebarVisible_;
    if (notesSidebarVisible_) {
        list_->setVisible(true);
        list_->setMinimumWidth(160);
        const int total = qMax(400, split_->width());
        const int w = qBound(160, savedNotesSidebarWidth_, total / 2);
        QList<int> visSizes;
        visSizes.append(w);
        visSizes.append(total - w);
        split_->setSizes(visSizes);
    } else {
        savedNotesSidebarWidth_ = qBound(160, list_->width(), 400);
        list_->setVisible(false);
        list_->setMinimumWidth(0);
        QList<int> hidSizes;
        hidSizes.append(0);
        hidSizes.append(qMax(200, split_->width()));
        split_->setSizes(hidSizes);
    }
    persistStateSoon();
    list_->doItemsLayout();
}

void MainWindow::persistStateSoon() {
    persistTimer_.start(200);
}

QString MainWindow::findRepoRoot() const {
    QDir d(QDir::currentPath());
    for (int i = 0; i < 32 && d.exists(); ++i) {
        if (QDir(d.absoluteFilePath(QStringLiteral(".git"))).exists())
            return d.absolutePath();
        if (!d.cdUp())
            break;
    }
    return QDir::currentPath();
}

QString MainWindow::notesDir() const {
    return QDir(repoRoot_).absoluteFilePath(QStringLiteral("notes"));
}

QString MainWindow::stateFilePath() const {
    return QDir(notesDir()).absoluteFilePath(QStringLiteral(".ui-state.json"));
}

void MainWindow::ensureNotesDir() {
    QDir().mkpath(notesDir());
}

void MainWindow::applyChrome() {
    const QColor win(0xf5, 0xf5, 0xf7);
    const QColor base(0xff, 0xff, 0xff);
    const QColor text(0x1d, 0x1d, 0x1f);
    const QColor btn(0xe8, 0xe8, 0xed);
    const QColor hl(0x0a, 0x7a, 0xff);
    const QColor hlText(0xff, 0xff, 0xff);
    const QColor listBg = base;
    const QColor toolBg(0xe6, 0xe6, 0xeb);
    const QColor toolBorder(0xc8, 0xc8, 0xd2);
    const QColor mdBarBg(0xee, 0xee, 0xf2);

    QPalette pal;
    pal.setColor(QPalette::Window, win);
    pal.setColor(QPalette::WindowText, text);
    pal.setColor(QPalette::Base, base);
    pal.setColor(QPalette::AlternateBase, win);
    pal.setColor(QPalette::Text, text);
    pal.setColor(QPalette::Button, btn);
    pal.setColor(QPalette::ButtonText, text);
    pal.setColor(QPalette::Highlight, hl);
    pal.setColor(QPalette::HighlightedText, hlText);
    qApp->setPalette(pal);
    if (list_)
        list_->setPalette(pal);
    if (sourceEditor_) {
        sourceEditor_->setPalette(pal);
        sourceEditor_->setPaper(base);
        sourceEditor_->setCaretForegroundColor(text);
        sourceEditor_->setMarginsBackgroundColor(win);
        sourceEditor_->setMarginsForegroundColor(text);
    }
    if (richEditor_)
        richEditor_->setPalette(pal);

    const QString tc = text.name(QColor::HexRgb);
    const QString tcb = toolBg.name(QColor::HexRgb);
    const QString tbr = toolBorder.name(QColor::HexRgb);
    const QString mbg = mdBarBg.name(QColor::HexRgb);
    if (leftToolBar_) {
        leftToolBar_->setPalette(pal);
        leftToolBar_->setStyleSheet(QStringLiteral(
            "QFrame#toolColumn { background-color: %1; border-right: 1px solid %2; }"
            "QFrame#toolColumn QPushButton, QFrame#toolColumn QToolButton {"
            "  text-align: left; padding: 7px 10px; border: none; border-radius: 5px;"
            "  background: transparent; color: %3; font-weight: 500;"
            "}"
            "QFrame#toolColumn QPushButton:hover, QFrame#toolColumn QToolButton:hover {"
            "  background-color: %4;"
            "}"
            "QFrame#toolColumn QPushButton:pressed, QFrame#toolColumn QToolButton:pressed {"
            "  background-color: %5;"
            "}"
            "QFrame#toolColumn QPushButton:focus, QFrame#toolColumn QToolButton:focus {"
            "  outline: none; background-color: %6; color: %7;"
            "}"
            "QPushButton#reopenBtn::menu-indicator { image: none; width: 0px; height: 0px; }"
            "QFrame#toolColumn QLabel { color: %3; }")
                                        .arg(tcb, tbr, tc, tcb, tbr, hl.name(QColor::HexRgb), hlText.name(QColor::HexRgb)));
    }
    if (mdPalette_) {
        mdPalette_->setStyleSheet(QStringLiteral(
            "QFrame#mdPalette { background-color: %1; border-bottom: 1px solid %2; }"
            "QFrame#mdPalette QPushButton { padding: 4px 10px; border-radius: 4px; color: %3; background: transparent; }"
            "QFrame#mdPalette QPushButton:hover { background-color: %4; }")
                                      .arg(mbg, tbr, tc, tcb));
    }
    if (list_) {
        list_->setStyleSheet(QStringLiteral(
            "QListWidget { background-color: %1; color: %2; }"
            "QListWidget::item { height: 28px; min-height: 28px; max-height: 28px; padding-left: 8px; }"
            "QListWidget::item:selected { background-color: %3; color: %4; }")
                                 .arg(listBg.name(QColor::HexRgb), tc, hl.name(QColor::HexRgb),
                                      hlText.name(QColor::HexRgb)));
    }
}

void MainWindow::refreshNoteList() {
    const QString sel = currentPath_;
    list_->clear();
    pathToItem_.clear();

    QDir nd(notesDir());
    struct Entry {
        qint64 mtime = 0;
        QString path;
        QString name;
    };
    QVector<Entry> entries;
    const QStringList files = nd.entryList(QDir::Files | QDir::NoDotAndDotDot, QDir::Name);
    entries.reserve(files.size());
    int umax = 0;
    QRegularExpression re(QStringLiteral(R"(^Untitled-(\d+)\.md$)"));
    for (const QString &name : files) {
        if (name == QStringLiteral(".ui-state.json"))
            continue;
        const QString fp = nd.absoluteFilePath(name);
        QFileInfo fi(fp);
        Entry e;
        e.mtime = fi.lastModified().toMSecsSinceEpoch();
        e.path = fp;
        e.name = name;
        entries.append(e);

        const QRegularExpressionMatch m = re.match(name);
        if (m.hasMatch())
            umax = qMax(umax, m.captured(1).toInt());
    }
    std::stable_sort(entries.begin(), entries.end(),
                     [](const Entry &a, const Entry &b) { return a.mtime > b.mtime; });
    untitledSeq_ = qMax(untitledSeq_, umax + 1);

    for (const Entry &ent : entries) {
        QFile f(ent.path);
        QString preview;
        if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
            const QByteArray line = f.readLine(512);
            preview = QString::fromUtf8(line);
        }
        auto *it = new QListWidgetItem(displayTitleForPath(ent.path, preview));
        it->setData(Qt::UserRole, ent.path);
        it->setToolTip(ent.path);
        list_->addItem(it);
        pathToItem_.insert(ent.path, it);
    }

    for (const QString &ep : externalPaths_) {
        if (pathToItem_.contains(ep))
            continue;
        if (!QFileInfo::exists(ep))
            continue;
        QFile f(ep);
        QString preview;
        if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
            const QByteArray line = f.readLine(512);
            preview = QString::fromUtf8(line);
        }
        auto *it = new QListWidgetItem(displayTitleForPath(ep, preview));
        it->setData(Qt::UserRole, ep);
        it->setToolTip(ep);
        list_->addItem(it);
        pathToItem_.insert(ep, it);
    }

    for (auto it = pathToItem_.constBegin(); it != pathToItem_.constEnd(); ++it) {
        if (it.key() == sel) {
            list_->setCurrentItem(it.value());
            break;
        }
    }
}

QString MainWindow::displayTitleForPath(const QString &path, const QString &contentPreview) const {
    const QString el = elideFirstLine(contentPreview);
    if (!el.isEmpty())
        return el;
    const QString base = QFileInfo(path).completeBaseName();
    static const QRegularExpression reUnt(QStringLiteral(R"(^Untitled-\d+$)"));
    if (reUnt.match(base).hasMatch())
        return base;
    const quint32 h = static_cast<quint32>(qHash(path));
    return QStringLiteral("Untitled-%1").arg(1 + int(h % 999999));
}
