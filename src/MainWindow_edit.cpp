#include "MainWindow.h"

#include <QJsonObject>
#include <QFile>
#include <QFileInfo>
#include <QListWidget>
#include <QListWidgetItem>
#include <Qsci/qscilexercpp.h>
#include <Qsci/qscilexermarkdown.h>
#include <Qsci/qscilexerpython.h>
#include <Qsci/qsciscintilla.h>
#include <QTextBlock>
#include <QTextCursor>
#include <QTextDocument>
#include <QTextEdit>
#include <QTimer>

namespace {
constexpr int kSaveDelayMs = 400;
}

void MainWindow::onListSelectionChanged() {
    if (!currentPath_.isEmpty())
        cursorByFile_.insert(currentPath_, captureCursorState());

    QListWidgetItem *item = list_->currentItem();
    if (!item) {
        flushSave();
        setBothEditorsText(QString());
        currentPath_.clear();
        updateSourceLexer(QString());
        return;
    }
    const QString newPath = item->data(Qt::UserRole).toString();
    if (newPath == currentPath_)
        return;
    flushSave();
    openPath(newPath);
}

void MainWindow::onSourceTextChanged() {
    if (loadingEditor_)
        return;
    updateSidebarTitleForCurrent();
    saveTimer_.start(kSaveDelayMs);
}

void MainWindow::onRichTextChanged() {
    if (loadingEditor_)
        return;
    updateSidebarTitleForCurrent();
    saveTimer_.start(kSaveDelayMs);
}

void MainWindow::flushSave() {
    if (currentPath_.isEmpty())
        return;
    QFile f(currentPath_);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text))
        return;
    f.write(currentPayload().toUtf8());
}

QString MainWindow::currentPayload() const {
    if (wysiwygMode_ && richEditor_)
        return richEditor_->toMarkdown(QTextDocument::MarkdownDialectGitHub);
    if (sourceEditor_)
        return sourceEditor_->text();
    return QString();
}

void MainWindow::setBothEditorsText(const QString &markdownUtf8) {
    loadingEditor_ = true;
    if (sourceEditor_)
        sourceEditor_->setText(markdownUtf8);
    if (richEditor_)
        richEditor_->setMarkdown(markdownUtf8);
    loadingEditor_ = false;
}

void MainWindow::syncWysiwygFromSource() {
    if (!sourceEditor_ || !richEditor_)
        return;
    const QString md = sourceEditor_->text();
    loadingEditor_ = true;
    richEditor_->setMarkdown(md);
    loadingEditor_ = false;
}

void MainWindow::syncSourceFromWysiwyg() {
    if (!sourceEditor_ || !richEditor_)
        return;
    const QString md = richEditor_->toMarkdown(QTextDocument::MarkdownDialectGitHub);
    loadingEditor_ = true;
    sourceEditor_->setText(md);
    loadingEditor_ = false;
}

void MainWindow::openPath(const QString &path) {
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        setBothEditorsText(QString());
        currentPath_.clear();
        updateSourceLexer(QString());
        return;
    }
    const QString body = QString::fromUtf8(f.readAll());
    setBothEditorsText(body);
    currentPath_ = path;
    updateSourceLexer(path);
    if (pathToItem_.contains(path))
        list_->setCurrentItem(pathToItem_.value(path));
    applyEditorFontSize();
    restoreCursorState(cursorByFile_.value(path));
}

void MainWindow::updateSourceLexer(const QString &path) {
    if (!sourceEditor_)
        return;
    const QString suf = QFileInfo(path).suffix().toLower();
    if (suf == QStringLiteral("py"))
        sourceEditor_->setLexer(new QsciLexerPython(sourceEditor_));
    else if (suf == QStringLiteral("cpp") || suf == QStringLiteral("cxx") || suf == QStringLiteral("h")
             || suf == QStringLiteral("hpp") || suf == QStringLiteral("cc"))
        sourceEditor_->setLexer(new QsciLexerCPP(sourceEditor_));
    else
        sourceEditor_->setLexer(new QsciLexerMarkdown(sourceEditor_));
}

void MainWindow::updateSidebarTitleForCurrent() {
    if (currentPath_.isEmpty())
        return;
    QListWidgetItem *item = pathToItem_.value(currentPath_, nullptr);
    if (!item)
        return;
    QString firstLine;
    if (wysiwygMode_ && richEditor_) {
        QTextDocument *doc = richEditor_->document();
        firstLine = doc->findBlockByNumber(0).text();
    } else if (sourceEditor_) {
        firstLine = sourceEditor_->text(0);
    }
    item->setText(displayTitleForPath(currentPath_, firstLine));
}

void MainWindow::insertMarkdownAround(const QString &before, const QString &after) {
    if (wysiwygMode_ && richEditor_) {
        QTextCursor c = richEditor_->textCursor();
        if (c.hasSelection()) {
            const QString mid = c.selectedText().replace(QChar(0x2029), QLatin1Char('\n'));
            c.insertText(before + mid + after);
        } else {
            c.insertText(before + after);
            c.movePosition(QTextCursor::Left, QTextCursor::MoveAnchor, after.length());
            richEditor_->setTextCursor(c);
        }
        return;
    }
    if (!sourceEditor_)
        return;
    if (sourceEditor_->hasSelectedText()) {
        QString sel = sourceEditor_->selectedText();
        sel.replace(QChar(0x2029), QLatin1Char('\n'));
        sourceEditor_->replaceSelectedText(before + sel + after);
    } else {
        sourceEditor_->insert(before + after);
        int line = 0;
        int idx = 0;
        sourceEditor_->getCursorPosition(&line, &idx);
        sourceEditor_->setCursorPosition(line, idx - after.length());
    }
}

void MainWindow::insertMarkdownLinePrefix(const QString &prefix) {
    if (wysiwygMode_ && richEditor_) {
        QTextCursor c = richEditor_->textCursor();
        c.movePosition(QTextCursor::StartOfBlock);
        c.insertText(prefix);
        richEditor_->setTextCursor(c);
        return;
    }
    if (!sourceEditor_)
        return;
    int line = 0;
    int idx = 0;
    sourceEditor_->getCursorPosition(&line, &idx);
    sourceEditor_->insertAt(prefix, line, 0);
}

QJsonObject MainWindow::captureCursorState() const {
    QJsonObject o;
    if (wysiwygMode_ && richEditor_) {
        o.insert(QStringLiteral("mode"), QStringLiteral("rich"));
        o.insert(QStringLiteral("pos"), richEditor_->textCursor().position());
    } else if (sourceEditor_) {
        o.insert(QStringLiteral("mode"), QStringLiteral("src"));
        int l = 0;
        int i = 0;
        sourceEditor_->getCursorPosition(&l, &i);
        o.insert(QStringLiteral("line"), l);
        o.insert(QStringLiteral("index"), i);
    }
    return o;
}

void MainWindow::restoreCursorState(const QJsonObject &o) {
    if (o.isEmpty() || loadingEditor_)
        return;
    const QString mode = o.value(QStringLiteral("mode")).toString();
    if (wysiwygMode_) {
        if (mode == QLatin1String("rich") && richEditor_) {
            QTextCursor c = richEditor_->textCursor();
            c.setPosition(o.value(QStringLiteral("pos")).toInt(0));
            richEditor_->setTextCursor(c);
        }
    } else {
        if (mode == QLatin1String("src") && sourceEditor_) {
            const int line = o.value(QStringLiteral("line")).toInt(0);
            const int index = o.value(QStringLiteral("index")).toInt(0);
            sourceEditor_->setCursorPosition(line, index);
        }
    }
}
