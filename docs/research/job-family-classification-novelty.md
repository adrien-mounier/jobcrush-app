# Robust job-family classification and novelty detection

Research for [Research robust job-family classification and novelty detection](https://github.com/adrien-mounier/jobcrush-app/issues/49), 2026-07-26.

## Decision summary

JobCrush should treat role placement as **open-set, selective classification**, not as vector search alone. A vector index will always return a nearest known item; it cannot by itself establish that the input belongs to any known Job family.

Use a three-stage system:

1. Retrieve known occupation examples with normalized sentence embeddings and cosine similarity.
2. Aggregate and calibrate evidence at the Job-family level, including absolute support, local neighbor density, and the margin between the first and second families.
3. Apply a three-way policy:
   - **Auto-place** only when known-family support and calibrated correctness both pass their gates and one family clearly leads.
   - **Clarify** when the input appears in-domain but two or more known families remain plausible.
   - **Unknown** when support for the known-family catalog is insufficient, even if one family is technically nearest.

The production boundary must be selected on a held-out, user-like evaluation corpus containing whole unseen families. It must not be chosen from an intuitive cosine number. The main safety target is the false-known rate: how often an actually unknown family is incorrectly accepted as known.

## Why nearest-neighbor retrieval is not unknown detection

Sentence-BERT was designed to produce semantically meaningful sentence embeddings that can be compared efficiently with cosine similarity. That makes it a strong candidate generator for short role descriptions ([Reimers and Gurevych, 2019](https://aclanthology.org/D19-1410/)).

But nearest-neighbor search ranks the catalog; it does not test catalog membership. “Nurse practitioner” still has a nearest vector in a catalog containing only Project Management roles. The current JobCrush stub demonstrates exactly this failure by placing every non-empty input into IT Project Manager.

Three signals answer different questions:

- **Top similarity or distance:** is the input close to examples of the leading family?
- **Top-one/top-two margin:** is one known family clearly better supported than another?
- **Local density:** does the input sit among several mutually consistent examples, or near one isolated accidental neighbor?

None is a probability by default. Thresholds depend on the embedding model, normalization, catalog composition, language, and family density. A model or catalog change therefore requires re-embedding and recalibration.

Research on out-of-domain intent classification is a useful analogue because it classifies short user utterances while retaining an unknown option. CLINC150 was created specifically because ordinary closed-set corpora assume every query has a supported label; its authors found that good in-scope classifiers still struggled with out-of-scope inputs ([Larson et al., 2019](https://aclanthology.org/D19-1131/)). KNN-contrastive work further supports density-based novelty detection without assuming each class is a single Gaussian region ([Zhou, Liu, and Qiu, 2022](https://aclanthology.org/2022.acl-long.352/)).

## Recommended representation and classifier

Build the searchable catalog from reviewed examples for each Job family:

- JobCrush family name and definition;
- canonical occupation titles;
- accepted aliases, abbreviations, and spelling variants;
- short scope descriptions;
- representative responsibilities or skill signatures where a title is ambiguous.

Authoritative taxonomies are seed material, not JobCrush ground truth. ESCO occupations include preferred, non-preferred, and hidden terms plus descriptions and skills, are mapped into the ISCO hierarchy, and are available through an official API and downloads ([ESCO occupations](https://esco.ec.europa.eu/en/classification/occupation-main), [ESCO API](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-api)). O*NET publishes occupation definitions and tens of thousands of alternate or lay job titles linked to O*NET-SOC occupations ([O*NET database](https://www.onetcenter.org/database.html), [Job Titles data dictionary](https://www.onetcenter.org/dictionary/30.3/csv/job_titles.html)).

These sources use their own taxonomies. Their category boundaries must not silently become JobCrush family boundaries. A reviewed mapping from each source occupation/example to a versioned JobCrush family is the label.

For an initial system:

1. Separate Target role text from location and other search intent.
2. Resolve exact, unambiguous reviewed aliases first.
3. Embed the role phrase and retrieve several examples, using cosine similarity on normalized embeddings.
4. Aggregate evidence by family rather than trusting a single example or one centroid. Multiple examples are important because a family can occupy several regions in embedding space.
5. Feed top support, top-two margin, neighbor agreement/density, and relevant metadata into a small supervised decision layer.
6. Calibrate its scores on a disjoint calibration set. Temperature scaling is a simple baseline, but its value must be verified on JobCrush text rather than assumed ([Guo et al., 2017](https://proceedings.mlr.press/v70/guo17a.html)).

An LLM may provide a structured semantic review or rerank the retrieved candidates, especially for sparse or compound descriptions. Its verbal confidence is not a calibrated probability and must not override the unknown gate. The same frozen prompt/model combination must be evaluated like any other classifier.

## Acceptance, ambiguity, and unknown policy

Tune the policy against product costs, with incorrect automatic placement considered more costly than a clarification or research pause.

**Auto-place** when all are true:

- the leading family has sufficient absolute and local support;
- neighbor votes are coherent rather than hinging on one item;
- the calibrated probability of a correct assignment meets the chosen target;
- the lead over the runner-up is sufficient;
- no rule identifies the title as intrinsically ambiguous.

**Clarify** when the input has credible known-family support but the margin is small or a calibrated prediction set contains multiple plausible families. Show two or three plain-language choices. “Project Manager / Product Manager” ambiguity is different from novelty: both may be known.

**Unknown** when absolute support or local density fails, or when the calibrated rejector identifies the input as outside the supported catalog. Never turn a weak nearest result into a family merely because every input needs a UI response.

Classification with abstention is an established selective-classification problem: accuracy can be traded against the proportion of inputs automatically covered ([Gangrade, Kag, and Saligrama, 2021](https://proceedings.mlr.press/v130/gangrade21a.html)). JobCrush should therefore choose a maximum acceptable error among auto-placed inputs, then maximize useful coverage under that constraint.

Conformal prediction sets can help express known-family ambiguity with coverage guarantees under exchangeability assumptions ([Romano, Sesia, and Candès, 2020](https://proceedings.neurips.cc/paper/2020/hash/244edd7e85dc81602b7615cd705545f5-Abstract.html)). They are not, by themselves, proof that an arbitrary new role is in-distribution; distribution shift breaks the premise that supports the guarantee.

## Evaluation corpus

Create a frozen, versioned gold corpus with adjudicated JobCrush labels and four partitions:

1. **Known-family inputs:** canonical titles, aliases, descriptions, abbreviations, spelling noise, and natural user phrasing for every published family.
2. **Near unknowns:** entire unpublished families that are occupationally adjacent to known ones. These are the hardest and most product-relevant novelty cases.
3. **Far unknowns:** unrelated occupations, non-role text, location-only input, and unusable text.
4. **Ambiguous inputs:** broad titles and genuine hybrids that reviewers judge to require user clarification.

Seed this corpus from ESCO and O*NET, then add independently reviewed synthetic paraphrases and privacy-approved production language. Test languages separately; multilingual taxonomy coverage does not prove multilingual embedding quality.

Avoid random row splits. Alternate titles and paraphrases of the same occupation can leak across train and test, producing an unrealistically easy result. Use grouped splits by canonical occupation, and a **leave-one-family-out** evaluation in which all examples from one or more families are absent during training and treated as unknown at test time. Keep a final blind test set untouched during threshold selection.

Use at least two reviewers for ambiguous and near-family examples, preserve acceptable multi-label judgments, and adjudicate disagreements. A previously unseen title can still be a new alias of a known family; lexical novelty is not family novelty.

## Metrics and release gate

Report the full three-way system, not only closed-set accuracy:

- **Known classification:** macro-F1, balanced accuracy, per-family recall, and top-k recall.
- **Calibration:** negative log-likelihood or Brier score, expected calibration error, reliability diagrams, and classwise checks.
- **Unknown detection:** AUROC, AUPR with unknown as positive, FPR at 95% unknown recall, and the false-known rate at the chosen operating point.
- **Selective behavior:** accuracy/error among auto-placed inputs, coverage, and a risk-coverage curve.
- **Clarification:** recall of the correct family in the offered set, average set size, and clarification rate.
- **Operational slices:** near versus far unknown, family frequency, language, abbreviations, typos, generic titles, and hybrid roles.

The release gate should state a maximum false-known rate and minimum auto-placement accuracy on the blind corpus; the actual numbers require a product risk decision and measured baseline. Thresholds may need partial pooling or per-family calibration because dense and sparse families do not share the same geometry. A global threshold is the baseline, not an assumption.

## Operational limitations

- OOD detection is empirical, not a guarantee against every future occupation.
- Near-unknown families are materially harder than obviously unrelated text.
- Sparse families and imbalanced examples can produce unreliable family-specific thresholds.
- Approximate vector indexes can introduce retrieval misses; measure recall against exact search before deployment.
- Embedding, LLM, taxonomy, or family-definition updates change the score distribution and invalidate old calibration.
- Broad titles such as “architect,” “producer,” or “consultant” may remain ambiguous without industry or responsibility context.
- Hybrid careers may validly need multiple candidates rather than one forced label.
- Monitor production auto-placement corrections, clarification choices, unknown rates, and drift by model and taxonomy version. Use reviewed outcomes to extend the corpus; do not self-train on unconfirmed predictions.

## Recommended next decision

Prototype the simplest hybrid baseline—reviewed aliases/profiles, normalized embeddings, family-aggregated kNN, and calibrated accept/clarify/reject gates—then select its operating point using grouped and leave-family-out evaluation. Defer heavier LLM research to the separate unknown-family workflow after this gate has correctly identified a likely unknown.
