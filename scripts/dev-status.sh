#!/usr/bin/env bash
# Herdr pane « PR et git »: where the pull requests and the release chain stand, and the state of git, refreshed every 30 s.
# Colour bars like the plan mod (green when done, yellow in progress, red when a check fails); everything turns green once the version
# is merged, tagged, released and its image published. Read only: it never changes git or GitHub.
#
#   scripts/dev-status.sh          follow (Ctrl+C to stop)
#   scripts/dev-status.sh --once   print once and exit
#   scripts/dev-status.sh open     create the pane above « MyServices dev » (herdr: split under it, then swap) and start it there
#   scripts/dev-status.sh close    close that pane
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
LABEL="PR et git"
REMOTE=github
EVERY=30
BAR=14

G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[90m'; B=$'\e[1m'; N=$'\e[0m'

# bar <done> <total> <colour>: ██████░░░░
bar() {
  local d=$1 t=$2 c=$3 n=0 i out=""
  ((t > 0)) && n=$((d * BAR / t))
  for ((i = 0; i < BAR; i++)); do ((i < n)) && out+="█" || out+="░"; done
  printf '%s%s%s' "$c" "${out:0:n}" "$D"; printf '%s%s' "${out:n}" "$N"
}

clip() { local s=$1 n=$2; ((${#s} > n)) && s="${s:0:n-1}…"; printf '%s' "$s"; }
mark() { case $1 in ok) printf '%s✓%s' "$G" "$N" ;; run) printf '%s▶%s' "$Y" "$N" ;; bad) printf '%s✗%s' "$R" "$N" ;; *) printf '%s·%s' "$D" "$N" ;; esac; }

# jq: counts of a list of checks or runs, as the gitstat mod classifies them (skipped and neutral count as passed)
COUNT='def kind: ((.conclusion // .state // "") | ascii_upcase) as $v | ((.status // "") | ascii_upcase) as $s
  | if ($v | IN("FAILURE","CANCELLED","TIMED_OUT","ERROR","STARTUP_FAILURE","ACTION_REQUIRED")) then "fail"
    elif (($s != "" and $s != "COMPLETED") or ($v | IN("PENDING","EXPECTED",""))) then "pending" else "pass" end;
  {pass: ([.[] | select(kind == "pass")] | length), pending: ([.[] | select(kind == "pending")] | length), fail: ([.[] | select(kind == "fail")] | length)}'

# colour of a count {pass,pending,fail}: red when one failed, yellow while some run, else green
tone() { local f=$1 p=$2; ((f > 0)) && printf '%s' "$R" || { ((p > 0)) && printf '%s' "$Y" || printf '%s' "$G"; }; }

# checks <json list> <label>: « CI ● 5/5 verts, 1 en cours, 1 en échec » in the colour of the count
checks() {
  local c p f t o; c=$(jq -c "$COUNT" <<<"$1"); o=$(jq -r .pass <<<"$c"); p=$(jq -r .pending <<<"$c"); f=$(jq -r .fail <<<"$c"); t=$((o + p + f))
  ((t == 0)) && return 0
  local extra=""
  ((p > 0)) && extra+=", $p en cours"
  ((f > 0)) && extra+=", $f en échec"
  printf ' %s%s ● %d/%d verts%s%s' "$(tone "$f" "$p")" "$2" "$o" "$t" "$extra" "$N"
}

sonar() {   # sonar <extra query>: the quality gate, « Sonar ✓ » or « Sonar ✗ »
  local st; st=$(curl -s --max-time 8 "https://sonarcloud.io/api/qualitygates/project_status?projectKey=Erreur32_MyServices&$1" | jq -r '.projectStatus.status // empty' 2>/dev/null)
  [[ $st == OK || $st == ERROR ]] || return 0   # none while the analysis is not done
  [[ $st == OK ]] && printf ' %sSonar ✓%s' "$G" "$N" || printf ' %sSonar ✗%s' "$R" "$N"
}

render() {
  local version branch dirty prs pr num state head total ok bad run tag release image
  version=$(jq -r .version "$ROOT/front/package.json" 2>/dev/null || echo "?")
  branch=$(git -C "$ROOT" branch --show-current 2>/dev/null)
  git -C "$ROOT" fetch -q "$REMOTE" --tags 2>/dev/null

  prs=$(gh pr list --state all --limit 8 --json number,title,state,headRefName,mergedAt,statusCheckRollup 2>/dev/null || echo "[]")
  # The pull request of the version (its title says « Version X.Y.Z »), else the newest open one
  pr=$(jq -c --arg v "$version" '(map(select(.title | contains("Version " + $v))) | .[0]) // (map(select(.state == "OPEN")) | .[0]) // null' <<<"$prs")

  tag=bad; git -C "$ROOT" rev-parse -q --verify "refs/tags/v$version" >/dev/null && tag=ok
  release=bad; gh release view "v$version" >/dev/null 2>&1 && release=ok
  image=bad
  if [[ $tag == ok ]]; then
    local runs; runs=$(gh run list --branch "v$version" --json workflowName,conclusion,status 2>/dev/null || echo "[]")
    if [[ $(jq 'length' <<<"$runs") -gt 0 ]]; then
      if jq -e 'all(.[]; .conclusion == "success" or .conclusion == "skipped")' >/dev/null <<<"$runs"; then image=ok
      elif jq -e 'any(.[]; .conclusion == "failure")' >/dev/null <<<"$runs"; then image=bad
      else image=run; fi
    fi
  fi

  # The chain of the version: pushed, pull request, checks, merged, tag, release, image
  local s_push=bad s_pr=bad s_ci=bad s_merge=bad cnt
  if [[ $pr != null ]]; then
    head=$(jq -r .headRefName <<<"$pr"); state=$(jq -r .state <<<"$pr"); num=$(jq -r .number <<<"$pr")
    s_pr=ok; [[ $state == MERGED ]] && { s_merge=ok; s_push=ok; }
    [[ $s_push == bad && $(git -C "$ROOT" rev-parse -q --verify "$head" 2>/dev/null) == $(git -C "$ROOT" rev-parse -q --verify "$REMOTE/$head" 2>/dev/null) ]] && s_push=ok
    cnt=$(jq -c ".statusCheckRollup | $COUNT" <<<"$pr"); ok=$(jq -r .pass <<<"$cnt"); run=$(jq -r .pending <<<"$cnt"); bad=$(jq -r .fail <<<"$cnt"); total=$((ok + run + bad))
    if ((bad > 0)); then s_ci=bad; elif ((total > 0 && run > 0)); then s_ci=run; elif ((total > 0)); then s_ci=ok; fi
  fi
  [[ $s_merge == ok && $s_ci != ok ]] && s_ci=ok
  [[ $s_merge == bad && $s_ci == ok ]] && s_merge=run
  local steps=(s_push s_pr s_ci s_merge tag release image) done=0 s
  for s in "${steps[@]}"; do [[ ${!s} == ok ]] && done=$((done + 1)); done
  local all=$((done == ${#steps[@]})) c=$Y
  ((all)) && c=$G
  [[ $s_ci == bad || $image == bad && $tag == ok ]] && c=$R

  printf '%s%s PR et git%s %s· %s%s\n' "$B" "$c" "$N" "$D" "$(date +%H:%M)" "$N"
  printf ' Version %s%s%s  ' "$B" "$version" "$N"; bar "$done" "${#steps[@]}" "$c"; printf ' %s%d/%d%s' "$c" "$done" "${#steps[@]}" "$N"
  ((all)) && printf '  %s✓ publiée%s' "$G" "$N"; printf '\n'
  printf '  %s poussée %s PR%s %s CI %s fusion %s tag %s release %s image\n' "$(mark "$s_push")" "$(mark "$s_pr")" "$([[ $pr != null ]] && echo " #$num")" "$(mark "$s_ci")" "$(mark "$s_merge")" "$(mark "$tag")" "$(mark "$release")" "$(mark "$image")"
  printf '\n'

  # main, as its remote has it: lag, CI and image of its last commit, Sonar gate, tag (like the gitstat mod)
  local msha mah mbh mruns mtag mdock
  msha=$(git -C "$ROOT" rev-parse -q --verify "$REMOTE/main" 2>/dev/null)
  read -r mah mbh < <(git -C "$ROOT" rev-list --left-right --count "main...$REMOTE/main" 2>/dev/null || echo "0 0")
  mruns=$(gh run list --commit "$msha" --json status,conclusion,workflowName 2>/dev/null || echo "[]")
  mtag=$(git -C "$ROOT" tag --points-at "$msha" --list 'v*' --sort=-v:refname 2>/dev/null | head -n 1)
  printf ' %s◆ main%s' "$B" "$N"
  if ((mbh > 0)); then printf '  %s↓%d à récupérer%s' "$D" "$mbh" "$N"; fi
  if ((mah > 0)); then printf '  %s↑%d non poussé%s' "$Y" "$mah" "$N"; fi
  ((mah == 0 && mbh == 0)) && printf '  %s✓ à jour%s' "$G" "$N"
  checks "$mruns" CI
  sonar "branch=main"
  [[ -n $mtag ]] && printf '  %s%s ✓%s' "$G" "$mtag" "$N" || printf '  %sdernier commit sans tag%s' "$Y" "$N"
  mdock=$(jq -r '[.[] | select(.workflowName | test("docker"; "i"))] | .[0] | if . == null then "" else ((.status // "") | ascii_upcase) + "/" + ((.conclusion // "") | ascii_upcase) end' <<<"$mruns")
  case $mdock in
    "") ;; COMPLETED/SUCCESS) printf '  %sDocker ✓%s' "$G" "$N" ;; COMPLETED/*) printf '  %sDocker ✗%s' "$R" "$N" ;; *) printf '  %sDocker ⏳%s' "$Y" "$N" ;;
  esac
  printf '\n'

  # The branch in use and the other branches that have an open pull request
  local br line bnum bchecks ahead behind
  { echo "$branch"; jq -r '.[] | select(.state == "OPEN") | .headRefName' <<<"$prs"; } | awk 'NF && !seen[$0]++' | while read -r br; do
    [[ $br == main ]] && continue
    read -r ahead behind < <(git -C "$ROOT" rev-list --left-right --count "$br...$REMOTE/$br" 2>/dev/null || echo "? ?")
    line=$(jq -c --arg b "$br" '[.[] | select(.state == "OPEN" and .headRefName == $b)] | .[0] // null' <<<"$prs")
    printf ' %s⎇ %s%s' "$([[ $br == "$branch" ]] && printf '%s' "$B" || printf '%s' "$D")" "$br" "$N"
    if [[ $ahead == "?" ]]; then printf '  %spas de remote%s' "$Y" "$N"
    elif [[ $ahead =~ ^[0-9]+$ ]] && ((ahead > 0)); then printf '  %s↑%d non poussé%s' "$Y" "$ahead" "$N"
    else printf '  %s✓ poussé%s' "$G" "$N"; fi
    [[ ${behind:-0} =~ ^[0-9]+$ ]] && ((behind > 0)) && printf '  %s↓%d en retard%s' "$D" "$behind" "$N"
    if [[ $line != null ]]; then
      bnum=$(jq -r .number <<<"$line"); bchecks=$(jq -c .statusCheckRollup <<<"$line")
      checks "$bchecks" "PR #$bnum"
      sonar "pullRequest=$bnum"
    fi
    printf '\n'
    if [[ $line != null ]]; then   # what has not passed yet
      jq -r '.statusCheckRollup[] | select(((.conclusion // .state // "") | ascii_upcase) as $v | ($v != "SUCCESS" and $v != "SKIPPED" and $v != "NEUTRAL"))
        | "\(if ((.conclusion // .state // "") | ascii_upcase | IN("FAILURE","CANCELLED","TIMED_OUT","ERROR")) then "x" else "r" end) \(.name // .context)"' <<<"$line" | while read -r k name; do
        printf '   %s %s\n' "$([[ $k == x ]] && mark bad || mark run)" "$(clip "$name" 50)"
      done
    fi
  done

  dirty=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l)
  printf '\n %s%d modifié(s)%s %s%s%s\n' "$([[ $dirty -gt 0 ]] && printf '%s' "$Y" || printf '%s' "$G")" "$dirty" "$N" "$D" "$(git -C "$ROOT" log -1 --format='%h %s' 2>/dev/null | cut -c1-44)" "$N"
}

case "${1:-}" in
  --once) render ;;
  open)
    [[ -n "${HERDR_ENV:-}" ]] || exit 0
    command -v herdr >/dev/null && command -v jq >/dev/null || exit 0
    dev=$(herdr pane list | jq -r '.result.panes[] | select(.label == "MyServices dev") | .pane_id' | head -n 1)
    [[ -n "$dev" ]] || { echo "pane « MyServices dev » not found" >&2; exit 1; }
    pane=$(herdr pane list | jq -r --arg l "$LABEL" '.result.panes[] | select(.label == $l) | .pane_id' | head -n 1)
    if [[ -z "$pane" ]]; then
      # herdr only splits right or down: split under « MyServices dev » (its process keeps running), then swap the two so the new pane is above
      pane=$(herdr pane split "$dev" --direction down --ratio 0.5 --cwd "$ROOT" --no-focus | jq -r '.result.pane.pane_id')
      herdr pane rename "$pane" "$LABEL" >/dev/null
      herdr pane swap --pane "$pane" --direction up >/dev/null
    else
      herdr pane send-keys "$pane" C-c >/dev/null; sleep 1
    fi
    herdr pane run "$pane" "$ROOT/scripts/dev-status.sh" >/dev/null
    ;;
  close)
    pane=$(herdr pane list 2>/dev/null | jq -r --arg l "$LABEL" '.result.panes[] | select(.label == $l) | .pane_id' | head -n 1)
    [[ -z "$pane" ]] || herdr pane close "$pane" >/dev/null
    ;;
  *)
    trap 'printf "\e[?25h"; exit 0' INT TERM
    printf '\e[?25l'
    while :; do
      out=$(render 2>&1)
      printf '\e[H\e[2J\e[3J%s\n' "$out"
      sleep "$EVERY"
    done
    ;;
esac
