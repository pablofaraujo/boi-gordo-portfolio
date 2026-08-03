import fs from "fs";
import path from "path";

describe("layout compacto das posições em aberto", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

  test("permite quebra de linha somente nos títulos da tabela", () => {
    expect(fonte).toMatch(/\.data-table th \{[\s\S]*?white-space: normal;/);
    expect(fonte).toMatch(/\.data-table td \{ padding: 6px 5px; \}/);
  });

  test("centraliza os títulos das posições em aberto nos dois eixos", () => {
    expect(fonte).toMatch(/\.data-table thead th,[\s\S]*?\.data-table thead th\.L \{[\s\S]*?text-align: center;[\s\S]*?vertical-align: middle;/);
  });

  test("centraliza verticalmente os dados, exceto a coluna de detalhes", () => {
    expect(fonte).toContain(".data-table tbody td { vertical-align: middle; }");
    expect(fonte).toContain(".data-table tbody td.details-cell { vertical-align: top; }");
  });

  test("organiza as cotações em duas linhas anuais de doze meses", () => {
    expect(fonte).toContain("const COTACOES_CALENDARIO = montarCalendarioCotacoes(new Date().getFullYear())");
    expect(fonte).toContain("grid-template-columns: repeat(12, minmax(82px, 1fr))");
    expect(fonte).toContain('className={`quote-card${encerrada ? " closed" : ""}`}');
    expect(fonte).toContain("Fechado");
  });

  test("resume cobertura sem duplicar posições abertas e separa resultados finalizados", () => {
    expect(fonte).toContain('["Bois Confinados",');
    expect(fonte).toContain('["Cobertos B3",');
    expect(fonte).not.toContain('["Posições abertas B3",');
    expect(fonte).toContain('["Resultado parcial em aberto", fmtResult(openNet), pnlColor(openNet)]');
    expect(fonte).toContain('["Resultado líquido fechado", fmtResult(closedNet), pnlColor(closedNet)]');
    expect(fonte).not.toContain("const totalNet = openNet + closedNet");
  });

  test("reserva dez colunas compactas e mais espaço para detalhes", () => {
    const tabela = fonte.match(/<table className="data-table">([\s\S]*?)<\/table>/)?.[1] || "";
    expect(tabela.match(/<col style=/g)).toHaveLength(10);
    expect(tabela).toContain('<col style={{ width: 150 }} />');
    expect(tabela).toContain('<col style={{ width: 60 }} />');
  });

  test("empilha os botões pequenos, centralizados e com a mesma largura", () => {
    expect(fonte).toMatch(/\.open-actions \{[^}]*flex-direction: column;[^}]*align-items: center;/);
    expect(fonte).toMatch(/\.open-action-button \{[\s\S]*?width: 50px;/);
    expect(fonte.match(/className="open-action-button"/g)).toHaveLength(2);
  });

  test("aplica o mesmo cabeçalho compacto ao histórico sem quebrar os valores", () => {
    expect(fonte).toMatch(/\.history-table th \{[\s\S]*?white-space: normal;/);
    expect(fonte).toMatch(/\.history-table thead th,[\s\S]*?\.history-table thead th\.L \{[\s\S]*?text-align: center;[\s\S]*?vertical-align: middle;/);
    expect(fonte).toContain(".history-table td:not(.details-cell) { white-space: nowrap; }");
    const historico = fonte.match(/<table className="history-table">([\s\S]*?)<\/table>/)?.[1] || "";
    expect(historico.match(/<col style=/g)).toHaveLength(13);
    expect(historico).toContain('<col style={{ width: 140 }} />');
    expect(historico).toContain("Ganho/<br />Perda");
    expect(historico).toContain("Negócio /<br />Rateio");
  });
});
